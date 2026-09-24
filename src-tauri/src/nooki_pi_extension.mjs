import { spawn } from "node:child_process";

const maximumOutputBytes = 1_000_000;

const parameters = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["search", "describe", "invoke"] },
    query: { type: "string" },
    capabilityId: { type: "string" },
    commandId: { type: "string" },
    input: {},
    language: { type: "string", enum: ["zh", "en"] },
  },
  required: ["action"],
  additionalProperties: false,
};

export default function (pi) {
  pi.registerTool({
    name: "nooki_capabilities",
    label: "Nooki capabilities",
    description: "Discover and use installed Nooki capability commands when relevant to the user's request. Search shows command names and descriptions; describe loads one command's schema; invoke runs it. For commands that accept conversation sources, Nooki supplies this turn's attachments automatically.",
    parameters,
    async execute(toolCallId, input, signal) {
      const helper = process.env.NOOKI_CAPABILITY_HELPER;
      if (!helper) throw new Error("Nooki capability helper is unavailable");
      const child = spawn(helper, ["--capability-call"], { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
      const stop = () => child.kill();
      signal?.addEventListener("abort", stop, { once: true });
      child.stdin.end(JSON.stringify({ ...input, invocationId: toolCallId }));
      let stdout = "", stderr = "";
      let oversized = false;
      const append = (current, chunk) => {
        const next = current + chunk;
        if (Buffer.byteLength(next) > maximumOutputBytes) { oversized = true; child.kill(); }
        return next.slice(0, maximumOutputBytes);
      };
      child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
      const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
      signal?.removeEventListener("abort", stop);
      if (oversized) throw new Error("Nooki capability helper output exceeds 1 MB");
      if (code !== 0) throw new Error(stderr.trim() || "Nooki capability helper failed");
      const response = JSON.parse(stdout);
      if (response.ok !== true) throw new Error(JSON.stringify(response.error));
      return { content: [{ type: "text", text: JSON.stringify(response) }], details: response };
    },
  });
}
