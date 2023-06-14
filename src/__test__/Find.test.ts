import { Core, Entity, User } from '@quatrain/core'
import { setup, createUsers } from './common'

const backend = setup()

let entity: Entity | undefined
let user: User

beforeAll(async () => {
   Core.classRegistry['User'] = User
   Core.classRegistry['Entity'] = Entity

   user = await User.factory()
})

afterAll(async () => {
   // Remove collections after all
   await backend.deleteCollection('user')
   await backend.deleteCollection('entity')
})

describe('Firestore find() operations', () => {
   test('find all entities records', async () => {
      entity = await Entity.factory()
      await entity.set('name', 'Acme Inc').save()

      // Query entities
      User.query()
         .execute()
         .then((res) => expect(res.length).toBe(1))
   })

   test('find records with filter on string property', () =>
      createUsers(user, 3, { lastname: 'Doe' }).then(() =>
         // Query users named Doe
         User.query()
            .where('lastname', 'Doe')
            .execute()
            .then((res) => expect(res.length).toBe(3))
      ))

   test('find records with filter on object property', () =>
      createUsers(user, 3, { entity }).then(() =>
         // Query users in entity Acme Inc.
         User.query()
            .where('lastname', 'Doe')
            .execute()
            .then((res) => expect(res.length).toBe(3))
      ))

   test('find records with filters on string and object properties', () =>
      createUsers(user, 2, { lastname: 'Doe', entity }).then(() =>
         // Query users in entity Acme Inc.
         User.query()
            .where('lastname', 'Doe')
            .where('entity', entity)
            .execute()
            .then((res) => expect(res.length).toBe(2))
      ))

   test('find users records within batch limit', () =>
      createUsers(user, 3).then(() =>
         // Query all users wirthout a batch value
         User.query()
            .execute()
            .then((res) => {
               //console.log(typeof res, res)
               expect(res.length).toBe(10)
            })
      ))

   test('find all users records', () => {
      // Query all users wirthout a batch value
      User.query()
         .batch(-1)
         .execute()
         .then((res) => expect(res.length).toBe(12))
   })
})
