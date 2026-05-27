import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Creates a Supabase admin client using the service_role key.
 * Used for storage operations where we need to bypass RLS
 * and do admin-level uploads on behalf of users.
 *
 * Falls back to the anon-key server client if SERVICE_ROLE_KEY is not set.
 */
function createStorageAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  }

  if (serviceKey) {
    return createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  // Fallback: use the anon server client (depends on user session cookie)
  return null;
}

/**
 * Upload an avatar image to the Supabase 'avatars' storage bucket.
 *
 * @param userId - The user's UUID (used as the folder name)
 * @param fileName - Original file name (sanitized before storing)
 * @param buffer - File data as a Buffer or ArrayBuffer
 * @param contentType - MIME type (e.g. image/jpeg)
 * @returns The public URL of the uploaded avatar
 */
export async function uploadAvatar(
  userId: string,
  fileName: string,
  buffer: Buffer | ArrayBuffer,
  contentType: string,
): Promise<string> {
  const adminClient = createStorageAdminClient();

  // Sanitize the filename — remove path separators, keep extension
  const safeName = fileName.replace(/[/\\]/g, "_").replace(/\s+/g, "_");
  const ext = safeName.includes(".")
    ? safeName.split(".").pop()?.toLowerCase() ?? "jpg"
    : "jpg";
  const storageKey = `${userId}/avatar.${ext}`;

  if (adminClient) {
    // Admin upload (service_role key)
    const { data, error } = await adminClient.storage
      .from("avatars")
      .upload(storageKey, buffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error("Supabase storage admin upload error:", error);
      throw new Error("Failed to upload avatar");
    }

    // Get public URL
    const {
      data: { publicUrl },
    } = adminClient.storage.from("avatars").getPublicUrl(storageKey);

    return publicUrl;
  }

  // Fallback: try to upload with the authenticated server client
  // This requires the user's Supabase session cookie to be present
  const serverClient = await createSupabaseServerClient();

  const { data, error } = await serverClient.storage
    .from("avatars")
    .upload(storageKey, buffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    console.error("Supabase storage upload error:", error);
    throw new Error(
      "Failed to upload avatar. Ensure Supabase is configured and avatars bucket exists.",
    );
  }

  const {
    data: { publicUrl },
  } = serverClient.storage.from("avatars").getPublicUrl(storageKey);

  return publicUrl;
}
