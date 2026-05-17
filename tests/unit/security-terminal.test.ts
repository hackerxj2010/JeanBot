import path from "node:path"
import { describe, expect, it } from "vitest"
import { TerminalService } from "../../services/terminal-service/src/index.js"

describe("TerminalService Security", () => {
  it("should block bypass of rm -rf / guardrail", async () => {
    const service = new TerminalService()
    expect(() => {
      // @ts-ignore - accessing private method for testing
      service.assertSafeCommand("rm -rf / ; echo 'unlucky'")
    }).toThrow(/Blocked terminal command pattern/)
  })

  it("should block path traversal via prefix bypass", async () => {
    const projectRoot = path.resolve(".")
    const parentOfProject = path.resolve("..")
    const evilPath = path.join(parentOfProject, "another-dir")

    const service = new TerminalService()
    // Use an allowed root that is NOT project root for this test
    const allowedRoot = path.join(projectRoot, "workspace")
    // @ts-ignore
    service.workspaceRoot = () => allowedRoot

    expect(() => {
      // @ts-ignore
      service.resolveCwd(evilPath)
    }).toThrow(/outside the allowed workspace root/)
  })

  it("should block traversal to parent of project root", async () => {
    const service = new TerminalService()
    const parentOfProject = path.resolve("..")
    expect(() => {
      // @ts-ignore
      service.resolveCwd(parentOfProject)
    }).toThrow(/outside the allowed workspace root/)
  })

  it("should allow paths inside project root", async () => {
    const service = new TerminalService()
    const projectFile = path.resolve("package.json")
    // @ts-ignore
    expect(service.resolveCwd(projectFile)).toBe(projectFile)
  })
})
