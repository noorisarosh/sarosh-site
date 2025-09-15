import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import pdf from 'pdf-parse';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// In-memory conversation store (temporary, resets on redeploy)
const conversations = new Map<string, { role: string; content: string }[]>();

// Disable body parser for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

async function extractTextFromFile(filePath: string, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase();
  
  try {
    if (ext === '.pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdf(dataBuffer);
      return data.text;
    } else if (ext === '.txt') {
      return fs.readFileSync(filePath, 'utf8');
    } else if (ext === '.doc' || ext === '.docx') {
      // For Word documents, you might need additional libraries like mammoth
      // For now, we'll return an error message
      throw new Error('Word document processing not implemented yet. Please convert to PDF or plain text.');
    } else {
      throw new Error(`Unsupported file format: ${ext}`);
    }
  } catch (error) {
    throw new Error(`Failed to extract text from file: ${error.message}`);
  }
}

function parseForm(req: VercelRequest): Promise<{ fields: any; files: any }> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      uploadDir: '/tmp',
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ fields, files });
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing API key" });
    }

    const { fields, files } = await parseForm(req);
    
    let textToAnalyze = fields.text || '';
    const conversationId = fields.conversationId || uuidv4();
    
    // Process uploaded file if present
    if (files.file) {
      const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
      
      try {
        const extractedText = await extractTextFromFile(uploadedFile.filepath, uploadedFile.originalFilename || '');
        textToAnalyze = extractedText + (textToAnalyze ? '\n\n' + textToAnalyze : '');
        
        // Clean up temporary file
        fs.unlinkSync(uploadedFile.filepath);
      } catch (fileError) {
        return res.status(400).json({ error: fileError.message });
      }
    }
    
    if (!textToAnalyze.trim()) {
      return res.status(400).json({ error: "No text provided to analyze (either in text field or file)" });
    }

    const newId = conversationId;
    const history = conversations.get(newId) || [];
    
    // Add system prompt for detailed analysis
    const systemPrompt = "analyze this simply, make sure i understand but dont simplify too much, still be in the detail and make sure all the details are there so i understand";
    const userPrompt = `${systemPrompt}\n\n${textToAnalyze}`;
    
    history.push({ role: "user", content: userPrompt });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "You are a helpful assistant that provides detailed, comprehensive analyses while maintaining clarity. Include all important details but explain them in an understandable way. Structure your response with clear sections and bullet points where appropriate."
        },
        ...history
      ],
      max_tokens: 2000, // Higher limit for detailed summaries
      temperature: 0.5,
    });

    const summary = completion.choices[0]?.message?.content || "Unable to generate detailed analysis";
    
    history.push({ role: "assistant", content: summary });
    conversations.set(newId, history);

    return res.status(200).json({ 
      summary: summary,
      conversationId: newId,
      type: "detailed_summary",
      hasFile: !!files.file
    });

  } catch (err: any) {
    console.error("Detailed summary error:", err);
    return res.status(500).json({ 
      error: "Failed to generate detailed summary", 
      details: err.message 
    });
  }
}
