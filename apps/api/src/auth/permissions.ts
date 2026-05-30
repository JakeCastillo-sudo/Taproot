import type { FastifyRequest, FastifyReply } from 'fastify';
import type { EmployeeRole } from '@taproot/shared';
import { ForbiddenError } from '../errors';

// ─── Permission enum ──────────────────────────────────────────────────────────

export enum Permission {
  // Orders
  ORDER_CREATE         = 'order:create',
  ORDER_VIEW           = 'order:view',
  ORDER_VOID           = 'order:void',
  ORDER_REFUND         = 'order:refund',
  ORDER_DISCOUNT_APPLY = 'order:discount:apply',
  ORDER_PRICE_OVERRIDE = 'order:price:override',
  ORDER_VIEW_ALL       = 'order:view:all',

  // Inventory
  INVENTORY_VIEW      = 'inventory:view',
  INVENTORY_ADJUST    = 'inventory:adjust',
  INVENTORY_COUNT     = 'inventory:count',
  INVENTORY_TRANSFER  = 'inventory:transfer',
  INVENTORY_PO_CREATE = 'inventory:po:create',
  INVENTORY_PO_RECEIVE = 'inventory:po:receive',
  INVENTORY_WASTE_LOG = 'inventory:waste:log',

  // Products
  PRODUCT_VIEW   = 'product:view',
  PRODUCT_CREATE = 'product:create',
  PRODUCT_EDIT   = 'product:edit',
  PRODUCT_DELETE = 'product:delete',
  RECIPE_MANAGE  = 'recipe:manage',

  // Customers
  CUSTOMER_VIEW   = 'customer:view',
  CUSTOMER_CREATE = 'customer:create',
  CUSTOMER_EDIT   = 'customer:edit',
  CUSTOMER_MERGE  = 'customer:merge',
  LOYALTY_ADJUST  = 'loyalty:adjust',

  // Employees
  EMPLOYEE_VIEW        = 'employee:view',
  EMPLOYEE_CREATE      = 'employee:create',
  EMPLOYEE_EDIT        = 'employee:edit',
  EMPLOYEE_DELETE      = 'employee:delete',
  EMPLOYEE_VIEW_SALES  = 'employee:sales:view:all',

  // Reporting
  REPORT_VIEW_BASIC     = 'report:view:basic',
  REPORT_VIEW_ADVANCED  = 'report:view:advanced',
  REPORT_EXPORT         = 'report:export',
  REPORT_VARIANCE       = 'report:variance',

  // Settings & Configuration
  SETTINGS_VIEW   = 'settings:view',
  SETTINGS_EDIT   = 'settings:edit',
  LOCATION_MANAGE = 'location:manage',
  DISCOUNT_MANAGE = 'discount:manage',
  TAX_MANAGE      = 'tax:manage',

  // Operations
  IMPORT_RUN = 'import:run',

  // AI Features
  AI_COPILOT = 'ai:copilot',
  AI_REPORTS = 'ai:reports',
}

const ALL_PERMISSIONS = Object.values(Permission) as Permission[];

// ─── Default role permission sets ─────────────────────────────────────────────

export const DEFAULT_ROLE_PERMISSIONS: Record<EmployeeRole, Permission[]> = {
  owner: ALL_PERMISSIONS,

  manager: ALL_PERMISSIONS.filter(
    (p) =>
      p !== Permission.EMPLOYEE_DELETE &&
      p !== Permission.SETTINGS_EDIT &&
      p !== Permission.TAX_MANAGE,
  ),

  cashier: [
    Permission.ORDER_CREATE,
    Permission.ORDER_VIEW,
    Permission.ORDER_DISCOUNT_APPLY,
    Permission.CUSTOMER_VIEW,
    Permission.CUSTOMER_CREATE,
    Permission.PRODUCT_VIEW,
    Permission.INVENTORY_VIEW,
    Permission.REPORT_VIEW_BASIC,
  ],

  kitchen: [
    Permission.PRODUCT_VIEW,
    Permission.INVENTORY_VIEW,
    Permission.INVENTORY_WASTE_LOG,
  ],

  readonly: [
    Permission.PRODUCT_VIEW,
    Permission.INVENTORY_VIEW,
    Permission.REPORT_VIEW_BASIC,
    Permission.CUSTOMER_VIEW,
  ],
};

// ─── Permission resolution ────────────────────────────────────────────────────

export function resolvePermissions(
  role: EmployeeRole,
  overrides: string[],
): Permission[] {
  const base = new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role] ?? []);
  const validPerms = new Set<string>(ALL_PERMISSIONS);

  for (const override of overrides) {
    if (override.startsWith('+')) {
      const perm = override.slice(1);
      if (validPerms.has(perm)) base.add(perm as Permission);
    } else if (override.startsWith('-')) {
      base.delete(override.slice(1) as Permission);
    }
  }

  return Array.from(base);
}

export function hasPermission(
  permissions: Permission[],
  required: Permission,
): boolean {
  return permissions.includes(required);
}

// ─── Fastify preHandler factory ───────────────────────────────────────────────

export function requirePermissions(
  ...required: Permission[]
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const user = (request as FastifyRequest & { user?: { permissions: string[] } | null }).user;

    if (!user) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenError('Insufficient permissions');
    }
  };
}
