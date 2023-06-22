import { Core, Entity, ObjectUri, User } from '@quatrain/core'
import { setup, createUsers, createEntity, createUser } from './common'

const backend = setup()

let user: User
let entity: Entity

beforeAll(async () => {
   Core.classRegistry['User'] = User
   Core.classRegistry['Entity'] = Entity

   entity = await createEntity()

   user = await User.factory()
   await createUsers(user)
   await createUsers(user, 3, { lastname: 'Doe' })
   await createUsers(user, 3, { entity })
   await createUsers(user, 2, { lastname: 'Doe', entity })
})

afterAll(async () => {
   // Remove collections after each test
   await Promise.all([
      backend.deleteCollection('user'),
      backend.deleteCollection('entity'),
   ])
})

describe('Firestore find() operations', () => {
   test('find all entities records', () =>
      Entity.query()
         .execute()
         .then((res) => expect(res.length).toBe(1)))

   test('find records with filter on string property', () =>
      // Query users named Doe
      User.query()
         .where('lastname', 'Doe')
         .execute()
         .then((res) => expect(res.length).toBe(5)))

   test('find records with filter on object property', () => {
      User.query()
         .where('entity', entity)
         .execute()
         .then((res) => expect(res.length).toBe(5))
   })

   test('find records with filters on string and object properties', () =>
      // Query users in entity Acme Inc.
      User.query()
         .where('lastname', 'Doe')
         .where('entity', entity)
         .execute()
         .then((res) => expect(res.length).toBe(2)))

   test('find users records within batch limit', async () => {
      // Query all users without a batch value
      const query = User.query()
      const res = await query.execute()
      expect(res.length).toBe(10)
   })

   test('find all users records', () =>
      // Query all users without a batch value
      User.query()
         .batch(-1)
         .execute()
         .then((res) => expect(res.length).toBe(13)))
})
