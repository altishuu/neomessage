import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { execSync } from "child_process";

const envContent = readFileSync("/home/ivanadcan35/Documents/Projects/Ishuu/neomessage/.env.production", "utf-8");
const env = {};
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  let key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  env[key] = val;
}

async function main() {
  // Login to get token
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: { session } } = await supabase.auth.signInWithPassword({
    email: "flowtest@neomessage.io",
    password: "FlowTest123!",
  });
  if (!session) { console.log("No session"); return; }

  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const token = session.access_token;

  // Test 1: Direct curl to PostgREST with auth headers
  console.log("=== Test 1: Insert via curl with Bearer token ===");
  try {
    const result = execSync(
      `curl -s -X POST "${baseUrl}/rest/v1/conversations" \
       -H "apikey: ${anonKey}" \
       -H "Authorization: Bearer ${token}" \
       -H "Content-Type: application/json" \
       -H "Accept: application/json" \
       -H "Prefer: return=representation" \
       -d '{"is_group":false}'`,
      { encoding: "utf-8", timeout: 10000 }
    );
    console.log("HTTP response:", result);
  } catch (e) {
    console.log("curl error:", e.message);
    if (e.stderr) console.log("stderr:", e.stderr.toString());
    if (e.stdout) console.log("stdout:", e.stdout.toString());
  }

  // Test 2: Via api with extra header
  console.log("\n=== Test 2: With the JWT role override ===");
  try {
    const result = execSync(
      `curl -s -w "\\nHTTP_CODE: %{http_code}" -X POST "${baseUrl}/rest/v1/conversations" \
       -H "apikey: ${anonKey}" \
       -H "Authorization: Bearer ${token}" \
       -H "Content-Type: application/json" \
       -H "Accept: application/json" \
       -H "Prefer: return=representation" \
       -d '{}'`,
      { encoding: "utf-8", timeout: 10000 }
    );
    console.log("Response:", result);
  } catch (e) {
    if (e.stdout) console.log("stdout:", e.stdout.toString());
  }
}

main().catch(e => console.error("Fatal:", e.message));
