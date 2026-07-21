import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

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
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  // Login
  const { data: { session } } = await supabase.auth.signInWithPassword({
    email: "flowtest@neomessage.io",
    password: "FlowTest123!",
  });
  if (!session) { console.log("Login failed"); return; }
  console.log("Logged in");

  const CONV_ID = "a25e1198-09c9-405d-8da7-639b1052f505";

  // Subscribe WITH the same filter the app uses
  console.log(`\nSubscribing with filter: conversation_id=eq.${CONV_ID}`);
  
  let eventReceived = false;
  const channel = supabase
    .channel("filtered-test")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${CONV_ID}`,
      },
      (payload) => {
        console.log("✅ FILTERED EVENT RECEIVED!", payload.eventType, payload.new.id);
        eventReceived = true;
      }
    )
    .subscribe((status) => {
      console.log("Subscription status:", status);
    });

  await new Promise(r => setTimeout(r, 3000));

  // Send a message IN the filtered conversation
  console.log("\nSending message in filtered conversation...");
  const { error: err } = await supabase
    .from("messages")
    .insert({
      conversation_id: CONV_ID,
      sender_id: session.user.id,
      content: "Filtered test message",
      type: "text",
    });
  
  if (err) console.log("Send error:", err.message, err.code);
  else console.log("Message sent");

  await new Promise(r => setTimeout(r, 8000));
  
  if (!eventReceived) {
    console.log("\n❌ FILTER: Event NOT received via Realtime with filter!");
    console.log("   The filter IS blocking the event.");
  } else {
    console.log("\n✅ FILTER: Event received correctly with filter!");
  }

  await supabase.removeChannel(channel);
}

main().catch(e => console.error("Fatal:", e.message));
