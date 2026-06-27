import { FastifyInstance } from 'fastify'
import { registerRoomCoreRoutes } from './rooms/room-core.routes.js'
import { registerRoomAssistantRoutes } from './rooms/room-assistant.routes.js'
import { registerRoomBillingRoutes } from './rooms/room-billing.routes.js'
import { registerRoomTaskRoutes } from './rooms/room-task.routes.js'
import { registerRoomMemberRoutes } from './rooms/room-member.routes.js'
import { registerRoomInviteRoutes } from './rooms/room-invite.routes.js'
import { registerRoomLeaveRoutes } from './rooms/room-leave.routes.js'

export async function registerRoomRoutes(app: FastifyInstance) {
  await registerRoomCoreRoutes(app)
  await registerRoomAssistantRoutes(app)
  await registerRoomBillingRoutes(app)
  await registerRoomTaskRoutes(app)
  await registerRoomMemberRoutes(app)
  await registerRoomInviteRoutes(app)
  await registerRoomLeaveRoutes(app)
}
