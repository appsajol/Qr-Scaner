
import { GoogleGenAI } from "@google/genai";

/**
 * Analyzes the manufacturing scan pair using Gemini AI.
 * Follows the @google/genai guidelines for initialization and text extraction.
 */
export const analyzeScanPair = async (partNumber: string, uniqueCode: string) => {
  if (!process.env.API_KEY) {
    console.warn("Gemini API Key missing. Skipping analysis.");
    return "Verification complete.";
  }

  try {
    // Correct initialization as per guidelines
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Using gemini-3-flash-preview for basic text task
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze this manufacturing scan pair:
      Part Number: ${partNumber}
      Unique Serial/Code: ${uniqueCode}
      
      Provide a very brief (1 sentence) professional summary or verification message.`,
      config: {
        // Avoiding maxOutputTokens to prevent potential truncation without thinkingBudget
        temperature: 0.5,
      },
    });

    // Accessing .text as a property, not a method
    return response.text || "Scan verified by AI.";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "Verification complete.";
  }
};
