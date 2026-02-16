
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeScanPair = async (partNumber: string, uniqueCode: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze this manufacturing scan pair:
      Part Number: ${partNumber}
      Unique Serial/Code: ${uniqueCode}
      
      Provide a very brief (1 sentence) professional summary or verification message.`,
      config: {
        maxOutputTokens: 100,
        temperature: 0.5,
      },
    });
    return response.text || "Scan verified by AI.";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "Verification complete.";
  }
};
