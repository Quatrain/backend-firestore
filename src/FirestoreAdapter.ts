import {
   AbstractAdapter,
   DataObjectClass,
   BackendParameters,
   BackendError,
   ObjectUri,
   Filters,
   Filter,
   SortAndLimit,
   Sorting,
   Core,
} from '@quatrain/core'
// do not convert to import as it is not yet supported
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Query, CollectionGroup } from 'firebase-admin/firestore'

export interface Reference {
   ref: string
   label: string
   [x: string]: any
}

const operatorsMap: { [x: string]: any } = {
   equals: '==',
   notEquals: '!=',
   greater: '>',
   greaterOrEquals: '>=',
   lower: '<',
   lowerOrEquals: '>',
   contains: 'in',
   notContains: 'not in',
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
      dataObject: DataObjectClass<any>
   ): Promise<DataObjectClass<any>> {
      try {
         if (dataObject.uid) {
            throw new BackendError(
               `Data object has an uid and can't be created`
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

         const collection = dataObject.uri.collection // || dataObject.uri.class?.name.toLowerCase()

         fullPath += collection

         // execute middlewares
         await this.executeMiddlewares(dataObject)

         const data = dataObject.toJSON()

         // Add keywords for firestore "full search"
         data.keywords = this._createKeywords(dataObject)

         const uid = getFirestore().collection(fullPath).doc().id

         const path = `${fullPath}/${uid}`

         const ref = getFirestore().doc(path)
         await ref.create(data)

         dataObject.uri.path = path
         dataObject.uri.label = data && Reflect.get(data, 'name')

         Core.log(`Saved object "${data.name}" at path ${path}`)

         return dataObject
      } catch (err) {
         console.log(err)
         Core.log((err as Error).message)
         throw new BackendError((err as Error).message)
      }
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
      await this.executeMiddlewares(dataObject)

      const { uid, ...data } = dataObject.toJSON()

      // Add keywords for firestore "full search"
      data.keywords = this._createKeywords(dataObject)

      await getFirestore().doc(dataObject.path).update(data)

      return dataObject
   }

   async delete(
      dataObject: DataObjectClass<any>
   ): Promise<DataObjectClass<any>> {
      if (dataObject.uid === undefined) {
         throw Error('Dataobject has no uid')
      }

      // execute middlewares
      await this.executeMiddlewares(dataObject)

      //dataObject.set('status', statuses.DELETED)
      //      await getFirestore().doc(dataObject.path).update(dataObject.toJSON())
      await getFirestore().doc(dataObject.path).delete()

      dataObject.uri = new ObjectUri()

      return dataObject
   }

   async deleteCollection(collection: string, batchSize = 500): Promise<void> {
      const collectionRef = getFirestore().collection(collection)
      const query = collectionRef.orderBy('__name__').limit(batchSize)

      return new Promise((resolve, reject) => {
         this._deleteQueryBatch(getFirestore(), query, resolve).catch(reject)
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

   async find(
      dataObject: DataObjectClass<any>,
      filters: Filters | Filter[] | undefined = undefined,
      pagination: SortAndLimit | undefined = undefined
   ): Promise<DataObjectClass<any>[]> {
      let fullPath = ''
      if (dataObject.path !== ObjectUri.DEFAULT) {
         fullPath = `${dataObject.path}/`
      }
      const collection =
         dataObject.uri.collection || dataObject.class.constructor.name

      if (!collection) {
         throw new BackendError(
            `Can't find collection matching object to query`
         )
      }

      fullPath += collection

      Core.log(`[FSA] Query on collection ${fullPath}`)

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
            if (filter.prop === 'keywords') {
               filter.operator = 'containsAll'
               filter.value = String(filter.value).toLowerCase()
            } else if (!dataObject.has(filter.prop)) {
               throw new BackendError(
                  `No such property '${filter.prop}' on object'`
               )
            }

            const property = dataObject.get(filter.prop)

            if (property.constructor.name === 'ObjectProperty') {
               // if property holds an instance extending BaseReference...
               filter.prop += '.ref'
               filter.value = filter.value && filter.value.uri.path
            }

            const realOperator = operatorsMap[filter.operator]

            query = query.where(filter.prop, realOperator, filter.value)
            Core.log(
               `filter added: ${filter.prop} ${realOperator} '${filter.value}'`
            )
         })
      }

      if (pagination) {
         console.debug('pagination data', pagination)
         pagination.sortings.forEach((sorting: Sorting) => {
            query = query.orderBy(sorting.prop, sorting.order)
         })
         query = query
            .limit(pagination.limits.batch)
            .offset(pagination.limits.offset || 0)
      }

      const snapshot = await query.get()

      //const dbutils = await getFirestore().doc(`dbutils/${collection}`).get()
      // const meta: Meta = {
      //    count: 0, //await this._getPartialCount(fullPath, baseQuery, { filters }),
      //    updatedAt: dbutils.get('updatedAt') || Date.now(),
      // }

      const items: DataObjectClass<any>[] = []

      snapshot.docs.forEach(async (doc: any) => {
         const { keywords, ...payload } = doc.data()
         items.push(await dataObject.clone(payload))
      })

      return items
   }

   protected _createKeywords(dataObject: DataObjectClass<any>): string[] {
      const keywords: string[] = []
      Object.keys(dataObject.properties)
         .filter((key: string) => dataObject.get(key).fullSearch === true)
         .forEach((key: string) => {
            const val = dataObject.val(key)
            if (val) {
               val.toLowerCase()
                  .split(' ')
                  .forEach((word: string) => {
                     let seq: string = ''
                     word
                        .split('')
                        .splice(0, 15)
                        .forEach((letter) => {
                           seq += letter
                           if (seq.length > 1) {
                              keywords.push(seq)
                           }
                        })
                  })
            }
         })

      return [...new Set(keywords)]
   }
}
