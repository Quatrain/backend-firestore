import {
   AbstractAdapter,
   BackendParameters,
   BackendError,
   DataObject,
   ObjectUri,
   statuses,
} from '@quatrain/core'
import { AbstractObject, User } from '@quatrain/core/lib/components'

export interface Reference {
   ref: string
   label: string
   [x: string]: any
}

// do not convert to import as it is not yet supported
import { getApps, initializeApp } from 'firebase-admin/app'

const { getFirestore, FieldValue } = require('firebase-admin/firestore')

// const operatorsMap: { [x: string]: any } = {
//    equals: '==',
//    notEquals: '!=',
//    greater: '>',
//    greaterOrEquals: '>=',
//    lower: '<',
//    lowerOrEquals: '>',
//    contains: 'in',
//    notContains: 'not in',
//    containsAll: 'array-contains',
//    containsAny: 'array-contains-any',
// }

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

   // static getCollection(obj: any) {
   //    const className = obj.constructor.name
   //    console.log('className', className)
   //    return Object.keys(classMap).find(key => {
   //       return classMap[key].name === className
   //    })
   // }

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

         const ref = getFirestore().doc(path)

         await ref.set(data)

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
}
