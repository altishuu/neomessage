import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Database } from "@/lib/supabase/types";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "text/plain", "application/zip"];

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const conversationId = formData.get("conversationId") as string | null;

    if (!file || !conversationId) {
      return NextResponse.json({ error: "Missing file or conversationId" }, { status: 400 });
    }

    // 1. Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File size exceeds 10MB limit" }, { status: 400 });
    }

    // 2. Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }

    // 3. Validate participant status
    const {
      data: participant,
      error: partError,
    } = await supabase
      .from("conversation_participants")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (partError || !participant) {
      return NextResponse.json({ error: "You are not a participant in this conversation" }, { status: 403 });
    }

    // 4. Define storage path: chat-attachments/{convId}/{userId}/{ts}-{filename}
    const timestamp = Date.now();
    const filename = file.name;
    const storagePath = `chat-attachments/${conversationId}/${user.id}/${timestamp}-${filename}`;

    // 5. Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("chat-attachments")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return NextResponse.json({ error: "File upload failed" }, { status: 500 });
    }

    // 6. Determine message type
    const messageType = file.type.startsWith("image/") ? "image" : "file";

    // 7. Insert message row into 'messages' table
    const { data: message, error: insertError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: user.id,
        type: messageType,
        content: filename, // content stores the filename for file messages
        metadata: {
          file_url: uploadData.path,
          mime_type: file.type,
          file_size: file.size,
          file_name: filename,
        },
      })
      .select("*")
      .single();

    if (insertError) {
      console.error("Database insert error:", insertError);
      // Optional: cleanup uploaded file if DB insert fails
      await supabase.storage.from("chat-attachments").remove([storagePath]);
      return NextResponse.json({ error: "Failed to record message in database" }, { status: 500 });
    }

    // 8. Generate signed URL for the uploaded file
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from("chat-attachments")
      .createSignedUrl(storagePath, 3600); // 1 hour expiration

    if (signedUrlError) {
      console.error("Signed URL error:", signedUrlError);
      return NextResponse.json({ error: "Failed to generate access URL" }, { status: 500 });
    }

    return NextResponse.json({
      message: {
        id: message.id,
        type: message.type,
        content: message.content,
        metadata: message.metadata,
        createdAt: message.created_at,
      },
      signedUrl: signedUrlData.signedUrl,
    });

  } catch (error) {
    console.error("Upload API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
