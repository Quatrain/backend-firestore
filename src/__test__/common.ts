import { Core, DataObject, Entity, User, utils } from '@quatrain/core'
import { FirestoreAdapter } from '../FirestoreAdapter'

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
   const user = await User.factory()
   user
      .set('firstname', 'John')
      .set('lastname', 'Doe')
      .set('email', 'john@doe.com')
      .set('password', 'azerty')

   return user
}

export const createEntity = async (forcedValues: any = {}) => {
   const res = await utils.DataGenerator(
      await Entity.factory(),
      1,
      forcedValues
   )

   //console.log(res)

   return res[0]
}

export const createUsers = (
   userModel: User,
   qty: number = 5,
   forcedValues: any = {}
): Promise<DataObject[]> => utils.DataGenerator(userModel, qty, forcedValues)
