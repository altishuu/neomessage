import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase.rpc("get_unread_counts", {
      p_user_id: user.id,
    });

    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error("Unread counts error:", error);
    console.error("Unread full:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
