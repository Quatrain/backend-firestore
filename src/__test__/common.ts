import { Core, DataObject, Entity, User, utils, Proxy } from '@quatrain/core'
import { FirestoreAdapter } from '../FirestoreAdapter'
import { UserCore } from '@quatrain/core/lib/components'
import { EntityCore } from '@quatrain/core/lib/components/Entity'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'

export const setup = () => {
   Core.addBackend(
      new FirestoreAdapter({
         config: {
            projectId: 'quatrain-core-firestore-admin-adapter-test',
            databaseURL: 'http://127.0.0.1:8080',
         },
      }),
      '@default'
   )

   return Core.getBackend()
}

export const createUser = async () => {
   const user = await UserCore.factory()
   user.firstname = 'John'
   user.lastname = 'Doe'
   user.email = 'john@doe.com'
   user.password = 'azerty'

   return user
}

export const createEntity = async (forcedValues: any = {}) => {
   const res = await utils.DataGenerator(
      await EntityCore.factory(),
      1,
      forcedValues
   )

   //console.log(res)

   return EntityCore.factory(res[0])
}

export const createUsers = (
   userModel: Proxy<User>,
   qty: number = 5,
   forcedValues: any = {}
): Promise<DataObject[]> => utils.DataGenerator(userModel, qty, forcedValues)
