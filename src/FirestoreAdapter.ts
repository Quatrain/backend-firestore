import {
   AbstractAdapter,
   BackendParameters,
   BackendError,
   DataObject,
   ObjectUri,
   statuses,
   Query,
   Filters,
   Filter,
   SortAndLimit,
} from '@quatrain/core'
import { BaseObject, User } from '@quatrain/core/lib/components'

export interface Reference {
   ref: string
   label: string
   [x: string]: any
}

// do not convert to import as it is not yet supported
import { getApps, initializeApp } from 'firebase-admin/app'

const { getFirestore, FieldValue } = require('firebase-admin/firestore')

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
   protected _user: User | ObjectUri | undefined = undefined
   protected _mapping: any = {}

   constructor(params: BackendParameters = { injectMeta: false }) {
      super(params)
      this._mapping = params.mapping
      if (getApps().length === 0) {
         initializeApp(params.config)
      }
   }

   set user(user: User | ObjectUri | undefined) {
      this._user = user
   }

   get user(): User | ObjectUri | undefined {
      return this._user
   }

   /**
    * Create record in backend
    * @param dataObject DataObject instance to persist in backend
    * @param desiredUid Desired UID for new record
    * @returns DataObject
    */
   async create(
      dataObject: DataObject,
      desiredUid: string | undefined = undefined
   ): Promise<DataObject> {
      try {
         // TODO check that object is not already existing in backend
         let fullPath = ''
         if (dataObject.get('parent')) {
            // if data contains a parent, it acts as a base path
            if (!dataObject.get('parent').ref) {
               throw new Error(
                  `DataObject has parent but parent is not persisted`
               )
            }
            fullPath = `${dataObject.get('parent').ref}/`
         }
         const collection =
            dataObject.uri.collection || dataObject.class.constructor.name

         fullPath += collection

         // add meta data
         if (this._injectMeta && this.user) {
            dataObject.set('createdAt', Date.now()) // Timestamp.create()
            dataObject.set(
               'createdBy',
               this.user instanceof User ? this.user.asReference() : this.user
            )
         }

         const data = dataObject.toJSON()

         // remove all properties that have an undefined value
         Object.keys(dataObject.properties).forEach((key: any) => {
            if (dataObject.val(key) === undefined) {
               console.log(`removing undefined property ${key}`)
               Reflect.deleteProperty(data, key)
            }
         })

         const uid = desiredUid || getFirestore().collection(fullPath).doc().id

         const path = `${fullPath}/${uid}`

         await getFirestore().doc(path).set(data)

         dataObject.uri.path = path
         dataObject.uri.label = Reflect.get(data, 'name')

         console.log(
            `Saved object ${dataObject.class.constructor.name} at path ${path}`
         )

         return dataObject
      } catch (err) {
         console.log(err)
         throw new BackendError((err as Error).message)
      }
   }

   async read(param: string | DataObject): Promise<DataObject> {
      const path = param instanceof DataObject ? param.uri.path : param

      const parts = path.split('/')
      if (parts.length < 2 || parts.length % 2 !== 0) {
         throw new Error(
            `path parts number should be even, received: '${path}'`
         )
      }

      console.log(`[FSA] Getting document ${path}`)

      const snapshot = await getFirestore().doc(path).get()

      if (!snapshot.exists) {
         throw Error(`No document matches path '${path}'`)
      }

      if (param instanceof DataObject) {
         param.populate(snapshot.data())
         return param
      } else {
         const dao = await DataObject.factory(parts[0])
         dao.uri = new ObjectUri(path)
         dao.populate(snapshot.data())
         dao.uri.label = dao.val('name')

         return dao
      }
   }

   async update(dataObject: DataObject): Promise<DataObject> {
      if (dataObject.uid === undefined) {
         throw Error('DataObject has no uid')
      }
      console.log(`[FSA] updating document ${dataObject.uid}`)
      if (this._injectMeta && this.user) {
         dataObject.set('updatedAt', Date.now()) // Timestamp.create())
         dataObject.set('updatedBy', this.user)
      }

      const { uid, ...data } = dataObject.toJSON()

      // prepare deletion of properties that have an undefined value
      Object.keys(dataObject.data).forEach((key: any) => {
         if (
            Reflect.has(dataObject, key) === true &&
            Reflect.get(dataObject, key) === undefined
         ) {
            Reflect.set(data, key, FieldValue.delete())
         }
      })

      Object.keys(data).forEach((key: any) => {
         if (!key.startsWith('_')) {
            const prop = Reflect.get(data, key)
            if (
               typeof prop === 'object' &&
               Reflect.has(prop, 'toJSON') === true
            ) {
               Reflect.set(data, key, prop.toJSON())
            }
         }
      })

      await getFirestore().doc(dataObject.path).update(data)

      return dataObject
   }

   async delete(dataObject: DataObject): Promise<DataObject> {
      if (dataObject.uid === undefined) {
         throw Error('Dataobject has no uid')
      }
      if (this._injectMeta && this.user) {
         dataObject.set('deletedAt', Date.now()) // Timestamp.create()
         dataObject.set('deletedBy', this.user)
      }
      dataObject.set('status', statuses.DELETED)
      await getFirestore().doc(dataObject.path).update(dataObject.toJSON())

      return dataObject
   }

   /**
    * Execute a query object
    * @param query Query
    * @returns Array<DataObject> | Array<T>
    */
   async query<T extends BaseObject>(
      query: Query<T>
   ): Promise<DataObject[] | T[]> {
      return await this.find(query.obj.dataObject, query.filters, query.sortAndLimit)
   }

   async find<T extends BaseObject>(
      dataObject: DataObject,
      filters: Filters | Filter[] | undefined = undefined,
      pagination: SortAndLimit | undefined = undefined
   ): Promise<DataObject[] | T[]> {
      let fullPath = ''
      if (dataObject.path !== ObjectUri.DEFAULT) {
         fullPath = `${dataObject.path}/`
      }
      const collection =
         dataObject.uri.collection || dataObject.class.constructor.name

      if (!collection) {
         throw new Error(`Can't find collection matching object to query`)
      }

      fullPath += collection

      console.log(`[FSA] Query on collection ${fullPath}`)

      let hasFilters = false
      let query: FirebaseFirestore.Query | FirebaseFirestore.CollectionGroup
      if (!dataObject.parent) {
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
            } else if (!Reflect.has(obj, filter.prop)) {
               throw new Error(`No such property '${filter.prop}' on object'`)
            }

            if (BaseReference.prototype.isPrototypeOf(obj[filter.prop])) {
               // if property holds an instance extending BaseReference...
               filter.prop += '.ref'
            }

            const realOperator = operatorsMap[filter.operator]

            query = query.where(filter.prop, realOperator, filter.value)
            console.log(
               `filter added: ${filter.prop} ${realOperator} '${filter.value}'`
            )
         })
      }

      // store query before pagination part
      const baseQuery = query.select()

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

      if (snapshot.empty) {
         return { items: [], meta: { count: 0, updatedAt: Date.now() } }
      }

      const dbutils = await getFirestore().doc(`dbutils/${collection}`).get()
      const meta: Meta = {
         count: await this._getPartialCount(fullPath, baseQuery, { filters }),
         updatedAt: dbutils.get('updatedAt') || Date.now(),
      }

      if (hasFilters === true) {
         meta.count = await this._getPartialCount(fullPath, baseQuery, {
            filters,
         })
      }

      const items: Array<any> = []

      snapshot.forEach((doc) => {
         const { keywords, ...payload } = doc.data()
         const obj = Reflect.construct(
            dataObject.class,
            doc.ref.path,
            payload,
            FirestoreAdapter
         )
         obj.backend = this
         items.push(obj)
      })

      return { items, meta }
   }

   protected _getPartialCount = async (
      collection: string,
      query: FirebaseFirestore.Query,
      params: any = {}
   ) => {
      const queryHash: string = hash.MD5(
         `${collection}-${JSON.stringify(params.filters)}`
      )

      const [base, id, subcollection] = collection.split('/')
      let ref = getFirestore().collection('dbutils').doc(base)

      // create doc if it doens't exist
      const baseDoc = await ref.get()
      if (!baseDoc.exists) {
         await ref.set({ updatedAt: Date.now() })
      }

      if (id && subcollection) {
         ref = ref.collection(subcollection).doc(id)
      }

      ref = ref.collection('counts').doc(queryHash)

      try {
         const doc = await ref.get()
         if (doc.exists) {
            return doc.get('count')
         } else {
            // count records matching filters before adding anything else
            const data = await query.get()
            await ref.set({
               count: data.docs.length,
               createdAt: Date.now(),
               path: collection,
               filters: JSON.stringify(params.filters || {}),
            })
            return data.docs.length
         }
      } catch (err) {
         console.log(
            `Unable to get partial count from cache for ${collection}: ${err}`
         )
      }
   }
}
