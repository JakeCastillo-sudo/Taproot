/**
 * Employee routes — admin management of staff. Restricted to owner/manager.
 * Auth handled by the global preHandler; org scope from JWT.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as EmployeeSvc from '../services/employee.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const { user } = req as AuthedRequest;
  if (user.role !== 'owner' && user.role !== 'manager') {
    reply.code(403).send({ code: 'FORBIDDEN', message: 'Manager or owner role required' });
    return false;
  }
  return true;
}

export default async function employeeRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/v1/employees/selectable — minimal list for the PIN lock screen.
  // Available to any authenticated device session (not just admins). Only
  // returns employees that have a PIN set; no email or sensitive fields.
  fastify.get('/api/v1/employees/selectable', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const employees = await EmployeeSvc.listSelectableEmployees(user.orgId);
    return reply.send({ employees });
  });

  // GET /api/v1/employees
  fastify.get('/api/v1/employees', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(req, reply)) return;
    const { user } = req as AuthedRequest;
    const employees = await EmployeeSvc.listEmployees(user.orgId);
    return reply.send({ employees });
  });

  // POST /api/v1/employees
  fastify.post('/api/v1/employees', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(req, reply)) return;
    const { user } = req as AuthedRequest;
    const created = await EmployeeSvc.createEmployee(user.orgId, req.body as EmployeeSvc.CreateEmployeeData, user.sub);
    return reply.code(201).send(created);
  });

  // PATCH /api/v1/employees/:id
  fastify.patch('/api/v1/employees/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    await EmployeeSvc.updateEmployee(user.orgId, id, req.body as EmployeeSvc.UpdateEmployeeData, user.sub);
    return reply.send({ success: true });
  });

  // DELETE /api/v1/employees/:id — soft delete (deactivate)
  fastify.delete('/api/v1/employees/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    await EmployeeSvc.deleteEmployee(user.orgId, id, user.sub);
    return reply.code(204).send();
  });

  // POST /api/v1/employees/:id/reset-pin
  fastify.post('/api/v1/employees/:id/reset-pin', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const { newPin } = req.body as { newPin: string };
    await EmployeeSvc.resetPin(user.orgId, id, newPin, user.sub);
    return reply.send({ success: true });
  });
}
