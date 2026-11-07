import { resolve } from "node:path";
import dotenv from "dotenv";

// Load .env from backend folder
dotenv.config({ path: resolve(__dirname, "../.env") });

function maskKey(key: string): string {
  if (key.length <= 10) return "********";
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

interface ChatResponse {
  id?: string;
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
    };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
    param?: string;
  };
}

interface ModelsResponse {
  data?: Array<{ id: string }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

async function testEndpoint(baseUrl: string, apiKey: string, model: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  console.log(`\n========================================`);
  console.log(`Testing Endpoint: ${normalizedBase}`);
  console.log(`Target Model:     ${model}`);
  console.log(`========================================`);

  // Step 1: Check authentication & list models
  console.log(`\n[1/2] Verifying authentication via GET ${normalizedBase}/models ...`);
  let availableModels: string[] = [];
  try {
    const modelsRes = await fetch(`${normalizedBase}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!modelsRes.ok) {
      const errBody = (await modelsRes.json().catch(() => null)) as ModelsResponse | null;
      console.error(`❌ Authentication failed! HTTP ${modelsRes.status} ${modelsRes.statusText}`);
      if (errBody?.error?.message) {
        console.error(`   Error message: ${errBody.error.message}`);
        console.error(`   Error type:    ${errBody.error.type || "unknown"}`);
        console.error(`   Error code:    ${errBody.error.code || "unknown"}`);
      } else {
        const raw = await modelsRes.text().catch(() => "");
        if (raw) console.error(`   Raw response: ${raw}`);
      }
      return { success: false, status: modelsRes.status, availableModels: [] };
    }

    const modelsData = (await modelsRes.json()) as ModelsResponse;
    availableModels = modelsData.data?.map((m) => m.id) ?? [];
    console.log(`✅ Authentication succeeded! Found ${availableModels.length} accessible model(s).`);
    if (availableModels.length > 0) {
      const sample = availableModels.slice(0, 6).join(", ");
      console.log(`   Sample models: ${sample}${availableModels.length > 6 ? ", ..." : ""}`);
    }
  } catch (err) {
    console.error(`❌ Network error while connecting to ${normalizedBase}/models:`);
    console.error(`   ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, status: 0, availableModels: [] };
  }

  // Step 2: Test live Chat Completion
  console.log(`\n[2/2] Testing chat completion via POST ${normalizedBase}/chat/completions ...`);
  const startTime = Date.now();
  try {
    const chatRes = await fetch(`${normalizedBase}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a connectivity test assistant. Be brief." },
          { role: "user", content: "Respond with the single word 'CONFIRMED'." },
        ],
        max_tokens: 15,
        temperature: 0,
      }),
    });

    const elapsedMs = Date.now() - startTime;

    if (!chatRes.ok) {
      const errBody = (await chatRes.json().catch(() => null)) as ChatResponse | null;
      console.error(`❌ Chat completion failed! HTTP ${chatRes.status} ${chatRes.statusText} (${elapsedMs}ms)`);
      if (errBody?.error?.message) {
        console.error(`   Error message: ${errBody.error.message}`);
        console.error(`   Error type:    ${errBody.error.type || "unknown"}`);
        console.error(`   Error code:    ${errBody.error.code || "unknown"}`);
      }
      return { success: false, status: chatRes.status, availableModels };
    }

    const chatData = (await chatRes.json()) as ChatResponse;
    const reply = chatData.choices?.[0]?.message?.content?.trim();
    console.log(`✅ Chat completion succeeded in ${elapsedMs}ms!`);
    console.log(`   Model responded: "${reply}"`);
    return { success: true, status: 200, availableModels };
  } catch (err) {
    console.error(`❌ Network error calling /chat/completions:`);
    console.error(`   ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, status: 0, availableModels };
  }
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const configuredBaseUrl = process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
  const configuredModel = process.env.OPENAI_MODEL?.trim();
  const cliModel = process.argv[2]?.trim();

  const targetModel = cliModel || configuredModel || "gpt-4o-mini";

  console.log("========================================");
  console.log("       OpenAI API Connectivity Test     ");
  console.log("========================================");

  if (!apiKey) {
    console.error("❌ ERROR: OPENAI_API_KEY is not defined in backend/.env!");
    process.exit(1);
  }

  console.log(`API Key:     ${maskKey(apiKey)}`);
  console.log(`Base URL:    ${configuredBaseUrl}`);
  console.log(`Model:       ${targetModel}`);

  const isDummyKey = apiKey === "sk-abcdef1234567890abcdef1234567890abcdef12" || apiKey.includes("abcdef");
  if (isDummyKey) {
    console.log("\n⚠️  WARNING: The key in your .env appears to be a placeholder/dummy key.");
    console.log("   (sk-abcdef1234567890abcdef1234567890abcdef12)");
  }

  // Attempt the test
  const result = await testEndpoint(configuredBaseUrl, apiKey, targetModel);

  // If the specific model failed with 404 (model not found) and we got other models from /models, try a known standard model
  if (!result.success && result.status === 404 && targetModel !== "gpt-4o-mini") {
    console.log(`\nModel '${targetModel}' was not found. Attempting fallback to 'gpt-4o-mini'...`);
    const fallbackResult = await testEndpoint(configuredBaseUrl, apiKey, "gpt-4o-mini");
    if (fallbackResult.success) {
      console.log("\n========================================");
      console.log("🎉 RESULT: Key is valid, but model name differed!");
      return;
    }
  }

  console.log("\n========================================");
  if (result.success) {
    console.log("🎉 RESULT: SUCCESS! Your OpenAI API key is working correctly.");
  } else {
    console.log("❌ RESULT: FAILED! Your OpenAI API key is NOT working.");
    if (result.status === 401) {
      console.log("\n💡 Reason: HTTP 401 Unauthorized (Invalid API Key).");
      console.log("   Please paste a valid key from https://platform.openai.com/api-keys");
      console.log("   into backend/.env at OPENAI_API_KEY=<your-key>");
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
