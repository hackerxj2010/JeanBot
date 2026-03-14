import { prisma } from "../../packages/db/src/index.js";

const now = new Date();
const tenantId = "dev-tenant";
const userId = "dev-user";
const workspaceId = "dev-workspace";

await prisma.tenant.upsert({
  where: {
    id: tenantId
  },
  update: {
    name: "JeanBot Dev Tenant"
  },
  create: {
    id: tenantId,
    name: "JeanBot Dev Tenant",
    slug: "dev-tenant",
    createdAt: now
  }
});

await prisma.user.upsert({
  where: {
    id: userId
  },
  update: {
    displayName: "Dev User"
  },
  create: {
    id: userId,
    tenantId,
    email: "dev@example.com",
    displayName: "Dev User",
    createdAt: now
  }
});

await prisma.workspace.upsert({
  where: {
    id: workspaceId
  },
  update: {
    name: "JeanBot Dev Workspace"
  },
  create: {
    id: workspaceId,
    tenantId,
    name: "JeanBot Dev Workspace",
    slug: "dev-workspace",
    createdAt: now
  }
});

await prisma.workspaceMembership.upsert({
  where: {
    id: "dev-membership"
  },
  update: {
    roleIds: ["admin"]
  },
  create: {
    id: "dev-membership",
    tenantId,
    workspaceId,
    userId,
    roleIds: ["admin"],
    createdAt: now
  }
});

console.log(
  JSON.stringify(
    {
      ok: true,
      tenantId,
      userId,
      workspaceId
    },
    null,
    2
  )
);

await prisma.$disconnect();
