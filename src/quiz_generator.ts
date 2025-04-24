import { App, Notice, requestUrl } from "obsidian";
import QuizGenPlugin from "./main";
import debug from "debug";
import * as _ from "underscore";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { QuizGeneratorSettings } from "./types";

const logger = debug("quizgenerator: QuizGenerator");

// Define Zod schemas for typed Quiz data
const FlashcardSchema = z.object({
    question: z.string(),
    answer: z.string(),
    quote: z.string(),
});

const QuizSchema = z.object({
    Questions: z.array(FlashcardSchema),
});

// Create TypeScript interfaces from Zod schemas
type Flashcard = z.infer<typeof FlashcardSchema>;
type Quiz = z.infer<typeof QuizSchema>;

export default class QuizGenerator {
    private plugin: QuizGenPlugin;
    private app: App;
    private n_gen_question: number;
    private client: OpenAI;

    constructor(app: App, plugin: QuizGenPlugin) {
        this.app = app;
        this.plugin = plugin;
        this.n_gen_question = 0;

    }

    public async generate(title: string): Promise<string[]> {
        logger(`Generating a Quiz on ${title}`);
        if (this.plugin.processing) {
            new Notice("There is already another generation process");
            logger("generate error", "There is another generation process");
            return Promise.reject(new Error("There is another generation process"));
        }

        this.plugin.processing = true;
        try {
            const currentFile = this.app.workspace.getActiveFile();
            if (!currentFile) return [];

            const content = await this.app.vault.read(currentFile);
            const chunks = this.preprocessText(content, 2000);

            let responses: string[] = [];
            let counter = 0;

            await Promise.all(
                chunks.map(async (chunk) => {
                    this.plugin.settings.prompt = this.getPrompt(chunk);
                    const quizData = await this.getQuizFromAPI(this.plugin.settings);
                    if (quizData) {
                        // Convert each flashcard into a string for storage
                        responses.push(...await this.stringifyJson(quizData));
                    }
                    counter += 1;
                    logger(`Generated quiz part ${counter} / ${chunks.length}`);
                })
            );

            return responses;
        } finally {
            this.plugin.processing = false;
        }
    }

    public async prune_question(text: string[]): Promise<string[]> {
        logger(`Currently pruning questions to a maximum of 10...`);
        if (this.n_gen_question > 10) {
            return _.sample(text, 10);
        }
        return text;
    }

    /**
     * Breaks text into sections by markdown headings, then lines, then periods.
     * Returns chunks subject to the specified chunk size.
     */
    private preprocessText(text: string, chunkSize: number): string[] {
        const chunks: string[] = [];
        const headingSections: string[] = text.split(/\n(?=#)/);
        const finalSegments: string[] = [];

        for (const headingSection of headingSections) {
            const lines = headingSection.split("\n");
            for (const line of lines) {
                const sentences = line.split(".");
                for (const sentence of sentences) {
                    const trimmed = sentence.trim();
                    if (trimmed.length > 0) {
                        finalSegments.push(trimmed);
                    }
                }
            }
        }

        let currentChunk = "";
        for (const segment of finalSegments) {
            if ((currentChunk + segment).length > chunkSize) {
                chunks.push(currentChunk.trim());
                currentChunk = "";
            }
            currentChunk += segment + ". ";
        }

        if (currentChunk !== "") {
            chunks.push(currentChunk.trim());
        }
        return chunks;
    }

    /**
     * Builds a prompt string to pass to the LLM.
     */
    private getPrompt(content: string): string {
        return `Give sets
        of question/answer for Anki cards based uniquely on this input in the proper JSON format:
        {
            "Questions": [
                {
                    "question": "",
                    "answer": "",
                    "quote": ""
                }
            ]
        }.
        The "question"/"answer"/"quote" properties must reflect data found in the text (no outside info). Note that the text is in markdown format and the response must be compatible (headers, lists, formulas, links, images, etc.).
        For the question, provide the most context as possible (section name, title, etc...)
        Respond with only valid JSON. 
        --- TEXT ---
        ${content}`;
    }

    /**
     * Sends a request to the OpenAI API and attempts to parse the response using the QuizSchema.
     */
    private async getQuizFromAPI(settings: QuizGeneratorSettings): Promise<Quiz | null> {
    try {
        const provider = settings.providers[settings.provider];
        const baseURL = provider.baseUrl;
        
        // For custom provider, ensure the baseURL is valid
        if (settings.provider === 'custom' && !baseURL) {
            new Notice("Custom provider URL not configured");
            return null;
        }

        // Get the appropriate API key and model
        const apiKey = settings.provider === 'ollama' ? "ollama" : provider.apiKey || "";
        const model = settings.engine;

        // Prepare headers based on provider requirements
        const headers: Record<string, string> = {
            "Content-Type": "application/json"
        };
        
        if (provider.requiresApiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        // Build request body (OpenAI format)
        const requestBody = {
            model: model,
            messages: [
                {
                    role: "system",
                    content: "You are an Anki Flashcard Generator, and you only return valid JSON that follows the requested schema."
                },
                { role: "user", content: settings.prompt }
            ],
            temperature: settings.temperature,
            response_format: zodResponseFormat(QuizSchema, "quiz_cards"),
        };

        const endpoint = provider.completionEndpoint || '/chat/completions';
        
        const response = await requestUrl({
            url: `${baseURL}${endpoint}`,
            method: "POST",
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        if (response.status === 200) {
            const data = response.json;
            const content = data.choices[0]?.message?.content;
            logger("Raw API response:", data);
            
            if (content) {
                try {
                    const parsed = JSON.parse(content);
                    logger("Parsed quiz data:", parsed);
                    return parsed as Quiz;
                } catch (parseError) {
                    logger("Failed to parse response as JSON:", parseError);
                    new Notice("Error: The model response was not valid JSON");
                }
            }
        } else {
            logger("API returned non-200 status:", response.status);
            new Notice(`API Error: ${response.status} - ${response.text?.substring(0, 100) || "Unknown error"}`);
        }
        
        return null;
    } catch (error) {
        logger("Error fetching quiz data:", error);
        new Notice(`Error: ${error.message}`);
        return null;
    }
}

    async stringifyJson(jsonResult: Quiz): Promise<string[]> {
		const result: string[] = [];
		for (const entry of jsonResult.Questions) {
			if (entry.answer != "" && entry.answer != "null" ) {
				const new_set = `${JSON.stringify(entry.question).replace(
					/\\\\/gm,
					"\\"
				)}\n?\n${JSON.stringify(entry.answer).replace(
					/\\\\/gm,
					"\\"
				)} *(Exact Quote : "${
					(entry.quote != "")? `${entry.quote}*` : "NA"
				})"\n\n`;
				result.push(new_set.replace(/"/gm, ""));
			}
		}
		return result;
	}

    /**
     * Helper function to pause execution for a given number of milliseconds.
     */
    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}