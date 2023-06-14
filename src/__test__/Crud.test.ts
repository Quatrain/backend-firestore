import { Core, Entity, User } from '@quatrain/core'
import { createUser, createUsers, setup } from './common'

const backend = setup()

beforeAll(async () => {
   Core.classRegistry['User'] = User
   Core.classRegistry['Entity'] = Entity

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

   test('find records without filter(s)', async () => {
      // create 5 users
      await createUsers(await User.factory())

      let query, res
      // Query all users
      query = User.query()
      res = await query.execute()
      expect(res.length).toBe(8)
   })
})
