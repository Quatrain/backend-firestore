import { Core, Entity, User, utils } from '@quatrain/core'
import { FirestoreAdapter } from '../FirestoreAdapter'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'

Core.addBackend(
   new FirestoreAdapter({
      config: {
         projectId: 'quatrain-core-firestore-admin-adapter-test',
         databaseURL: 'http://127.0.0.1:8080',
      },
   }),
   '@default'
)

const createUser = async () => {
   const user = await User.factory()
   user
      .set('firstname', 'John')
      .set('lastname', 'Doe')
      .set('email', 'john@doe.com')
      .set('password', 'azerty')

   return user
}

const createUsers = async (
   userModel: User,
   qty: number = 5,
   forcedValues: any = {}
) => {
   await utils.DataGenerator(userModel, qty, forcedValues)
}

const backend = Core.getBackend()

// Remove collection before all
beforeAll(async () => {
   await backend.deleteCollection('user')
   await backend.deleteCollection('entity')
})

describe('Firestore CRUD operations', () => {
   test('write data', async () => {
      // Check that object is successfully created in backend
      const user = await createUser()
      await user.save()
      expect(user.dataObject.isPersisted()).toBe(true)
      expect(user.uri).not.toBeUndefined()
      expect(user.uid).not.toBeUndefined()
      expect(user.uri.constructor.name).toBe('ObjectUri')
   })

   test('read data', async () => {
      // Save user
      const user = await createUser()
      await user.save()

      // Retrieve user from empty object and record path
      const user2 = await User.factory()
      user2.uri.path = user.path

      await backend.read(user2.dataObject)
      expect(user2.val('name')).toBe(user.val('name'))
   })

   test('update data', async () => {
      const user = await createUser()
      await user.save()

      user.set('firstname', 'Jane')
      await user.save()

      // Retrieve user from empty object and record path
      const user2 = await User.factory()
      user2.uri.path = user.path

      await backend.read(user2.dataObject)
      expect(user2.val('name')).toBe(user.val('name'))
   })

   test('delete data', async () => {
      const user = await createUser()
      await user.save()
      expect(user.uid).toBeDefined()

      await user.delete()
      expect(user.uid).toBeUndefined()
   })

   test.only('find records with or without filter(s)', async () => {
      // create 5 users
      await createUsers(await User.factory())

      // create 3 users named 'Doe'
      await createUsers(await User.factory(), 3, { lastname: 'Doe' })

      // create 3 users in entity 'Acme Inc'
      const entity = await Entity.factory()
      await entity.set('name', 'Acme Inc').save()

      await createUsers(await User.factory(), 3, { entity })

      let query, res
      // Query all users
      query = User.query()
      res = await query.execute()
      expect(res.length).toBe(10)

      // Query users named Doe
      query = User.query()
      query.where('lastname', 'Doe')
      res = await query.execute()
      expect(res.length).toBe(3)

      await createUsers(await User.factory(), 2, { lastname: 'Doe', entity })

      // Query users in entity Acme Inc.
      query = User.query()
      query.where('lastname', 'Doe')
      query.where('entity', entity)
      res = await query.execute()
      expect(res.length).toBe(2)
   })
})
