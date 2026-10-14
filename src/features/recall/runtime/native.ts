import { invoke } from '@tauri-apps/api/core'
import type { AssistantRunContext, AssistantRunRequest } from '../contracts.generated'
export interface NativeAgentBridge {
  begin(request: AssistantRunRequest): Promise<AssistantRunContext>
  finish(runId: string): Promise<void>
  tool(runId: string, name: string, input: unknown): Promise<unknown>
  verifyTools(runId: string, supported: boolean): Promise<void>
}
export const nativeAgentBridge: NativeAgentBridge = {
  begin: request => invoke('assistant_run_begin', { request }),
  finish: runId => invoke('assistant_run_finish', { runId }),
  tool: (runId, name, input) =>
    invoke('assistant_run_tool', { runId, name, arguments: JSON.stringify(input) }),
  verifyTools: (runId, supported) => invoke('assistant_verify_tools', { runId, supported }),
}
