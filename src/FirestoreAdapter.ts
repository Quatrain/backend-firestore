import {
   AbstractAdapter,
   DataObjectClass,
   BackendParameters,
   BackendError,
   ObjectUri,
   QueryMetaType,
   QueryResultType,
   Filters,
   Filter,
   SortAndLimit,
   Sorting,
   Core,
   statuses,
} from '@quatrain/core'
import { BackendAction } from '@quatrain/core/lib/Backend'

// do not convert to import as it is not yet supported
import { getApps, initializeApp } from 'firebase-admin/app'
import {
   getFirestore,
   Query,
   CollectionGroup,
   WhereFilterOp,
} from 'firebase-admin/firestore'

export interface Reference {
   ref: string
   label: string
   [x: string]: any
}

const operatorsMap: { [x: string]: WhereFilterOp } = {
   equals: '==',
   notEquals: '!=',
   greater: '>',
   greaterOrEquals: '>=',
   lower: '<',
   lowerOrEquals: '>',
   contains: 'in',
   notContains: 'not-in',
   containsAll: 'array-contains',
   containsAny: 'array-contains-any',
}

export class FirestoreAdapter extends AbstractAdapter {
   constructor(params: BackendParameters = {}) {
      super(params)
      if (getApps().length === 0) {
         initializeApp(params.config)
      }
   }

   /**
    * Create record in backend
    * @param dataObject DataObject instance to persist in backend
    * @returns DataObject
    */
   async create(
      dataObject: DataObjectClass<any>,
      desiredUid: string | undefined
   ): Promise<DataObjectClass<any>> {
      return new Promise(async (resolve, reject) => {
         try {
            if (dataObject.uid) {
               throw new BackendError(
                  `Data object already has an uid and can't be created`
               )
            }
            let fullPath = ''
            if (dataObject.has('parent')) {
               // if data contains a parent, it acts as a base path
               if (!dataObject.get('parent').ref) {
                  throw new BackendError(
                     `DataObject has parent but parent is not persisted`
                  )
               }
               fullPath = `${dataObject.get('parent').ref}/`
            }

            const collection = this.getCollection(dataObject)

            fullPath += collection

            // execute middlewares
            await this.executeMiddlewares(dataObject, BackendAction.CREATE)

            const data = dataObject.toJSON(true)

            const uid =
               desiredUid || getFirestore().collection(fullPath).doc().id

            const path = `${fullPath}/${uid}`

            const ref = getFirestore().doc(path)
            await ref.create(data)

            dataObject.uri.path = path
            dataObject.uri.label = data && Reflect.get(data, 'name')

            Core.log(`Saved object "${data.name}" at path ${path}`)

            resolve(dataObject)
         } catch (err) {
            console.log(err)
            Core.log((err as Error).message)
            reject(new BackendError((err as Error).message))
         }
      })
   }

   async read(dataObject: DataObjectClass<any>): Promise<DataObjectClass<any>> {
      const path = dataObject.path

      const parts = path.split('/')
      if (parts.length < 2 || parts.length % 2 !== 0) {
         throw new BackendError(
            `path parts number should be even, received: '${path}'`
         )
      }

      Core.log(`[FSA] Getting document ${path}`)

      const snapshot = await getFirestore().doc(path).get()

      if (!snapshot.exists) {
         throw new BackendError(`No document matches path '${path}'`)
      }

      dataObject.populate(snapshot.data())

      this.executeMiddlewares(dataObject, BackendAction.READ)

      return dataObject
   }

   async update(
      dataObject: DataObjectClass<any>
   ): Promise<DataObjectClass<any>> {
      if (dataObject.uid === undefined) {
         throw Error('DataObject has no uid')
      }
      Core.log(`[FSA] updating document ${dataObject.path}`)

      // execute middlewares
      await this.executeMiddlewares(dataObject, BackendAction.UPDATE)

      const { uid, ...data } = dataObject.toJSON()

      await getFirestore().doc(dataObject.path).update(data)

      return dataObject
   }

   async delete(
      dataObject: DataObjectClass<any>
   ): Promise<DataObjectClass<any>> {
      if (dataObject.uid === undefined) {
         throw new BackendError('Dataobject has no uid')
      }

      // execute middlewares
      await this.executeMiddlewares(dataObject, BackendAction.DELETE)

      if (this._params.softDelete === true) {
         dataObject.set('status', statuses.DELETED)
         await getFirestore().doc(dataObject.path).update(dataObject.toJSON())
      } else {
         await getFirestore().doc(dataObject.path).delete()
      }

      dataObject.uri = new ObjectUri()

      return dataObject
   }

   async deleteCollection(collection: string, batchSize = 500): Promise<void> {
      Core.log(`Deleting all records from collection '${collection}'`)
      const collectionRef = getFirestore().collection(collection)
      const query = collectionRef.orderBy('__name__').limit(batchSize)

      return new Promise(async (resolve) => {
         await this._deleteQueryBatch(getFirestore(), query, resolve)
         resolve()
      })
   }

   protected async _deleteQueryBatch(
      db: FirebaseFirestore.Firestore,
      query: Query,
      resolve: any
   ) {
      const snapshot = await query.get()

      const batchSize = snapshot.size
      if (batchSize === 0) {
         // When there are no documents left, we are done
         resolve()
         return
      }

      // Delete documents in a batch
      const batch = db.batch()
      snapshot.docs.forEach((doc) => {
         batch.delete(doc.ref)
      })
      await batch.commit()

      // Recurse on the next process tick, to avoid
      // exploding the stack.
      process.nextTick(() => {
         this._deleteQueryBatch(db, query, resolve)
      })
   }

   /**
    * Execute a query on a collection
    * @param dataObject
    * @param filters
    * @param pagination
    * @returns
    */
   async find(
      dataObject: DataObjectClass<any>,
      filters: Filters | Filter[] | undefined = undefined,
      pagination: SortAndLimit | undefined = undefined
   ): Promise<QueryResultType<DataObjectClass<any>>> {
      let fullPath = ''
      if (dataObject.path !== ObjectUri.DEFAULT) {
         fullPath = `${dataObject.path}/`
      }
      const collection = this.getCollection(dataObject)

      if (!collection) {
         throw new BackendError(
            `Can't find collection matching object to query`
         )
      }

      fullPath += collection

      Core.log(`[FSA] Query on collection '${collection}'`)

      let hasFilters = false
      let query: Query | CollectionGroup
      if (false) {
         // find a way to detect sub collection
         query = getFirestore().collectionGroup(fullPath)
      } else {
         query = getFirestore().collection(fullPath)
      }

      if (filters instanceof Filters) {
         hasFilters = true
      } else if (Array.isArray(filters)) {
         // list of filters objects
         filters.forEach((filter) => {
            let realProp = filter.prop
            let realOperator: WhereFilterOp
            let realValue = filter.value

            // Process text search firestore-mode
            if (filter.prop === 'keywords') {
               console.log(filter)
               realOperator = operatorsMap['containsAll']
               realValue = String(filter.value).toLowerCase()
            } else if (!dataObject.has(filter.prop)) {
               throw new BackendError(
                  `No such property '${filter.prop}' on object'`
               )
            } else {
               const property = dataObject.get(filter.prop)

               if (property.constructor.name === 'ObjectProperty') {
                  realProp = `${filter.prop}.ref`

                  if (filter.value instanceof ObjectUri) {
                     realValue = filter.value.path
                  } else {
                     realValue =
                        (filter.value &&
                           filter.value.uri &&
                           filter.value.uri.path) ||
                        filter.value
                  }
               }

               realOperator = operatorsMap[filter.operator]
            }
            query = query.where(realProp, realOperator, realValue)

            Core.log(`filter added: ${realProp} ${realOperator} ${realValue}`)
         })
      }

      const countSnapshot = await query.count().get()

      if (pagination) {
         pagination.sortings.forEach((sorting: Sorting) => {
            query = query.orderBy(sorting.prop, sorting.order)
         })
         query = query.offset(pagination.limits.offset || 0)
         if (pagination.limits.batch !== -1) {
            query = query.limit(pagination.limits.batch)
         }
      }

      const snapshot = await query.get()

      const meta: QueryMetaType = {
         count: countSnapshot.data().count,
         offset: pagination?.limits.offset || 0,
         batch: pagination?.limits.batch || 20,
         sortField: pagination?.sortings[0].prop,
         executionTime: Core.timestamp(),
      }

      const items: DataObjectClass<any>[] = []

      for (const doc of snapshot.docs) {
         const { keywords, ...payload } = doc.data()

         const newDataObject: DataObjectClass<any> = await dataObject.clone({
            ...payload,
         })

         newDataObject.uri = new ObjectUri(
            `${this.getCollection(dataObject)}/${doc.id}`,
            newDataObject.val('name')
         )
         this.executeMiddlewares(newDataObject, BackendAction.READ)

         items.push(newDataObject)
      }

      return { items, meta }
   }
}
