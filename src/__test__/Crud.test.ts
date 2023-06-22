import { Core, Entity, User } from '@quatrain/core'
import { createUser, createUsers, setup } from './common'

const backend = setup()
let user: User

beforeAll(async () => {
   Core.classRegistry['User'] = User
   Core.classRegistry['Entity'] = Entity

   user = await createUser()
   await user.save()
})

afterAll(async () => {
   await backend.deleteCollection('user')
   //await backend.deleteCollection('entity')
})

describe('Firestore CRUD operations', () => {
   test('write data', async () => {
      // Check that object is successfully created in backend
      expect(user.dataObject.isPersisted()).toBe(true)
      expect(user.uri).not.toBeUndefined()
      expect(user.uid).not.toBeUndefined()
      expect(user.uri.constructor.name).toBe('ObjectUri')
   })

   test('read data', async () => {
      // Retrieve user from empty object and record path
      const user2 = await User.factory()
      user2.uri.path = user.path

      await backend.read(user2.dataObject)
      expect(user2.val('name')).toBe(user.val('name'))
   })

   test('update data', async () => {
      user.set('firstname', 'Jane')
      await user.save()

      // Retrieve user from empty object and record path
      const user2 = await User.factory()
      user2.uri.path = user.path

      await backend.read(user2.dataObject)
      expect(user2.val('name')).toBe(user.val('name'))
   })

   test('delete data', async () => {
      expect(user.uid).toBeDefined()

      await user.delete()
      expect(user.uid).toBeUndefined()
   })
})
