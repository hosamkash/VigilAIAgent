import { describe, expect, it } from "vitest";

/** Mirrors sidecar/approvals.mjs buildToolPolicies for unit coverage. */
function buildToolPolicies(autoRun: boolean) {
  const autoApprove = !!autoRun;
  const dangerous = { enabled: true, autoApprove };
  return {
    write_file: dangerous,
    apply_patch: dangerous,
    run_commands: dangerous,
    search_files: { enabled: true, autoApprove: true },
    search_codebase: { enabled: true, autoApprove: true },
    find_definition: { enabled: true, autoApprove: true },
    find_references: { enabled: true, autoApprove: true },
    parallel_investigate: { enabled: true, autoApprove: true },
    reindex_codebase: { enabled: true, autoApprove: true },
    get_ci_status: { enabled: true, autoApprove: true },
    prepare_worktree: { enabled: true, autoApprove: false },
    create_pull_request: { enabled: true, autoApprove: false },
    delegate_tasks: { enabled: true, autoApprove },
    push_and_check_ci: { enabled: true, autoApprove },
  };
}

describe("agent tool policies", () => {
  it("requires approval for write/run/patch/delegates/push when Auto-run is off", () => {
    const policies = buildToolPolicies(false);
    expect(policies.write_file.autoApprove).toBe(false);
    expect(policies.apply_patch.autoApprove).toBe(false);
    expect(policies.run_commands.autoApprove).toBe(false);
    expect(policies.delegate_tasks.autoApprove).toBe(false);
    expect(policies.push_and_check_ci.autoApprove).toBe(false);
    expect(policies.create_pull_request.autoApprove).toBe(false);
    expect(policies.search_files.autoApprove).toBe(true);
    expect(policies.find_definition.autoApprove).toBe(true);
    expect(policies.parallel_investigate.autoApprove).toBe(true);
  });

  it("auto-approves dangerous tools when Auto-run is on", () => {
    const policies = buildToolPolicies(true);
    expect(policies.write_file.autoApprove).toBe(true);
    expect(policies.run_commands.autoApprove).toBe(true);
    expect(policies.delegate_tasks.autoApprove).toBe(true);
    expect(policies.push_and_check_ci.autoApprove).toBe(true);
  });
});
