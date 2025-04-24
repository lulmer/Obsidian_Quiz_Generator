import {
	App,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	requestUrl,
} from "obsidian";

import { QuizGeneratorSettings } from "./types";
import { openFile, createFileWithInput } from "src/utils";
import QuizGenerator from "./quiz_generator";
import { SetPath } from "./set_path";
import safeAwait from "safe-await";
import debug from "debug";

const logger = debug("textgenerator:main");

const SYSTEM_PROMPT = `You are a quiz generator, you will be feed an input with the flags [INPUT] and you will give sets
 of question/answer for anki cards based uniquely on this input in the following json format:
 " [OUTPUT]{"Questions" : [{ "key_info" : "The obitore are a community from the south west of asia that are selling erasers",
	\n"question" : "What are the obitore ? ",
	\n"answer" : "A community from the south west of asia know for selling erasers.",
	\n"quote" : "The obitore are a community from the south west of asia that are selling erasers[...] (line 4)"}, ... ]} }".
	The key_info property must be a quote from the [INPUT] text.
	If you ask a question that depends on a specific context/conditions, precise it in the question.
   In a json, the attribute name MUST be \'"\' and not \'\'\'. All the questions must have their response in the input text,
    don\'t add additional information but try having elaborate answers (you are allowed to rephrase). 
	Forget every exterior knowledge. Note that the [INPUT] is written in a markdown format, hence the OUTPUT.answers 
	have to be compatible to markdown. If there are not enough information in the token return an empty json.`; 
//const SYSTEM_PROMPT = "You are a Anki Flashcard generator."

const DEFAULT_SETTINGS: QuizGeneratorSettings = {
	provider: 'openai',
	providers: {
		openai: {
			name: 'OpenAI',
			baseUrl: 'https://api.openai.com/v1',
			requiresApiKey: true,
		},
		ollama: {
			name: 'Ollama',
			baseUrl: 'http://localhost:11434/v1',
			requiresApiKey: false,
		},
		openrouter: {
			name: 'OpenRouter',
			baseUrl: 'https://openrouter.ai/api/v1',
			requiresApiKey: true,
		},
		together: {
			name: 'Together AI',
			baseUrl: 'https://api.together.xyz/v1',
			requiresApiKey: true,
		},
		lmstudio: {
			name: 'LM Studio',
			baseUrl: 'http://localhost:1234/v1',
			requiresApiKey: false,
		},
		deepseek: {
			name: 'Deepseek',
			baseUrl: 'https://api.deepseek.com',
			requiresApiKey: true,
		},
		custom: {
			name: 'Custom (OpenAI-compatible API)',
			baseUrl: '',
			requiresApiKey: true,
		},
	},
	// api_key removed - now stored per provider
	engine: "gpt-3.5-turbo",
	temperature: 0.7,
	frequency_penalty: 0.5,
	prompt: "",
	system_prompt: SYSTEM_PROMPT,
	showStatusBar: true,
	outputToBlockQuote: false,
	promptsPath: "textgenerator/prompts",
	displayErrorInEditor: false,
};

export default class QuizGenPlugin extends Plugin {
	settings: QuizGeneratorSettings;
	defaultSettings: QuizGeneratorSettings;
	processing = false;
	//TODO : Give the file where the cursor is (Not necessary) -> clear
	getActiveView() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView !== null) {
			return activeView;
		} else {
			new Notice("The file type should be Markdown!");
			return null;
		}
	}
	async generateQuiz() {
		this.settings.system_prompt = SYSTEM_PROMPT;
		const activeFile = this.app.workspace.getActiveFile();

		console.log("Creating the questions ...");
		const quizgen = new QuizGenerator(this.app, this);

		let title;
		if (activeFile !== null) {
			title = `${activeFile.basename} Quiz`;
		} else {
			logger("You have to select a file.");
			title = "NewQuiz";
		}
		let responses: string[] = await quizgen.generate(title);
		if (this.settings.prune) {
			responses = await quizgen.prune_question(responses);
		}
		const response = responses.join("\n");

		const content = "# Generated Quiz\n\n#flashcards\n" + response;
		const suggestedPath = `${title}.md`;

		//Open a new note and write string
		new SetPath(this.app, suggestedPath, async (path: string) => {
			const [errorFile, file] = await safeAwait(
				createFileWithInput(path, content, this.app)
			);
			if (errorFile) {
				logger("createTemplate error", errorFile);
				return Promise.reject(errorFile);
			}
			openFile(this.app, file);
		}).open();

		this.processing = false;
	}
	async onload() {
		this.defaultSettings = DEFAULT_SETTINGS;
		await this.loadSettings();
		//addIcon('genquiz', '')

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon(
			"checkbox-glyph",
			"Quiz Generator",
			async (evt: MouseEvent) => {
				// Called when the user clicks the icon.
				statusBarItemEl.setText("Generating Quiz ...");
				this.generateQuiz();
				statusBarItemEl.setText("No Quiz Generation");
				this.processing = false;
			}
		);
		// Perform additional things with the ribbon
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText("No Quiz Generation");

		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: "genquiz-modal",
			name: "Generate quiz",
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						this.generateQuiz();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new QuizGenSettingTab(this.app, this));
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			loadedData || {}
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class QuizGenSettingTab extends PluginSettingTab {
    plugin: QuizGenPlugin;

    constructor(app: App, plugin: QuizGenPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // Provider selection
        new Setting(containerEl)
            .setName("LLM Provider")
            .setDesc("Select which AI provider to use")
            .addDropdown((dropdown) => {
                Object.entries(this.plugin.settings.providers).forEach(([key, provider]) => {
                    dropdown.addOption(key, provider.name);
                });
                
                dropdown.setValue(this.plugin.settings.provider)
                    .onChange(async (value: any) => {
                        this.plugin.settings.provider = value;
                        await this.plugin.saveSettings();
                        this.display(); // Refresh to show relevant settings
                    });
            });

        // Provider-specific settings - handle both async methods safely
        if (this.plugin.settings.provider === 'custom') {
            this.displayCustomSettings().catch(error => {
                console.error("Error displaying custom settings:", error);
                new Notice("Failed to load custom provider settings");
            });
        } else {
            this.displayStandardSettings().catch(error => {
                console.error("Error displaying settings:", error);
                new Notice("Failed to load provider settings");
            });
        }

        // Common settings for all providers
        this.displayCommonSettings();
    }

    async displayStandardSettings(): Promise<void> {
        const { containerEl } = this;
        const provider = this.plugin.settings.providers[this.plugin.settings.provider];
        
        if (provider.requiresApiKey) {
            new Setting(containerEl)
                .setName("API Key")
                .setDesc(`API key for ${provider.name}`)
                .addText((text) =>
                    text
                        .setPlaceholder(`Enter your ${provider.name} API key`)
                        .setValue(provider.apiKey || "")
                        .onChange(async (value) => {
                            this.plugin.settings.providers[this.plugin.settings.provider].apiKey = value;
                            await this.plugin.saveSettings();
                        })
                );
        }

        // Model selection
        let models: any[] = [];
        let fetchError = false;
        
        try {
            // If API not required or we have a valid API key, try to fetch models
            if (!provider.requiresApiKey || provider.apiKey) {
                models = await this.fetchModelsForProvider(this.plugin.settings.provider);
            }
        } catch (error) {
            console.error("Failed to fetch models:", error);
            fetchError = true;
        }
        
        const modelSetting = new Setting(containerEl)
            .setName("Model")
            .setDesc(`Select model for ${provider.name}`);
            
        // Add refresh button to fetch models
        modelSetting.addButton((button) => {
            button
                .setButtonText("Refresh Models")
                .setTooltip("Fetch available models from provider")
                .onClick(async () => {
                    new Notice("Fetching available models...");
                    try {
                        const freshModels = await this.fetchModelsForProvider(this.plugin.settings.provider);
                        if (freshModels && freshModels.length > 0) {
                            new Notice(`Found ${freshModels.length} models from ${provider.name}`);
                        } else {
                            new Notice("No models found. Check your API key and connection.");
                        }
                        // Refresh the display
                        this.display();
                    } catch (error) {
                        console.error("Failed to fetch models:", error);
                        new Notice("Failed to fetch models. Check console for details.");
                    }
                });
            });
            
        if (models && models.length > 0) {
            // Show dropdown if we have models
            modelSetting.addDropdown((dropdown) => {
                models.forEach(model => {
                    dropdown.addOption(model.id, model.id);
                });
                
                dropdown.setValue(this.plugin.settings.engine || (models[0]?.id || ""))
                    .onChange(async (value) => {
                        this.plugin.settings.engine = value;
                        await this.plugin.saveSettings();
                    });
            });
        } else {
            // Fallback to text input with appropriate message
            const placeholder = fetchError 
                ? "Failed to fetch models, enter model name manually" 
                : "Enter model name (e.g., gpt-4o)";
                
            modelSetting.addText((text) =>
                text
                    .setPlaceholder(placeholder)
                    .setValue(this.plugin.settings.engine)
                    .onChange(async (value) => {
                        this.plugin.settings.engine = value;
                        await this.plugin.saveSettings();
                    })
            );
        }
    }
    
    async fetchModelsForProvider(providerKey: string): Promise<any[]> {
        const provider = this.plugin.settings.providers[providerKey];
        
        try {
            const headers: Record<string, string> = {
                "Content-Type": "application/json"
            };
            
            // Add Authorization header if API key is required
            if (provider.requiresApiKey && provider.apiKey) {
                // Anthropic uses a different header format
                if (provider.apiFormat === 'anthropic') {
                    headers["x-api-key"] = provider.apiKey;
                    headers["anthropic-version"] = "2023-06-01";
                } else {
                    headers["Authorization"] = `Bearer ${provider.apiKey}`;
                }
            }
            
            // Use the provider's modelListEndpoint or default to /models
            const modelEndpoint = provider.modelListEndpoint || '/models';
            const response = await requestUrl({
                url: `${provider.baseUrl}${modelEndpoint}`,
                method: 'GET',
                headers: headers
            });
            
            if (response.status === 200 && response.json) {
                // All providers use the 'data' array format for models
                if (response.json.data) {
                    if (provider.apiFormat === 'anthropic') {
                        // For Anthropic, use display_name if available
                        return response.json.data.map((model: any) => ({
                            id: model.id,
                            name: model.display_name || model.id
                        }));
                    }
                    // Standard OpenAI format
                    return response.json.data;
                }
            }
        } catch (error) {
            console.error(`Failed to fetch models for ${provider.name}:`, error);
            new Notice(`Could not fetch models from ${provider.name}. Check your connection.`);
        }
        
        return [];
    }

    async displayCustomSettings(): Promise<void> {
        const { containerEl } = this;
        
        new Setting(containerEl)
            .setName("API Base URL")
            .setDesc("Custom API endpoint URL")
            .addText((text) =>
                text
                    .setPlaceholder("https://api.example.com/v1")
                    .setValue(this.plugin.settings.providers.custom.baseUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.providers.custom.baseUrl = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("API Key")
            .setDesc("API key for custom endpoint")
            .addText((text) =>
                text
                    .setPlaceholder("Enter your API key")
                    .setValue(this.plugin.settings.providers.custom.apiKey || "")
                    .onChange(async (value) => {
                        this.plugin.settings.providers.custom.apiKey = value;
                        await this.plugin.saveSettings();
                    })
            );
            
        // Model selection
        let models: any[] = [];
        let fetchError = false;
        
        try {
            // Try to fetch models if we have both URL and API key
            if (this.plugin.settings.providers.custom.baseUrl && this.plugin.settings.providers.custom.apiKey) {
                models = await this.fetchModelsForProvider('custom');
            }
        } catch (error) {
            console.error("Failed to fetch models for custom provider:", error);
            fetchError = true;
        }
        
        const modelSetting = new Setting(containerEl)
            .setName("Model")
            .setDesc("Model name for your custom endpoint");
            
        // Add refresh button to fetch models
        modelSetting.addButton((button) => {
            button
                .setButtonText("Fetch Models")
                .setTooltip("Fetch available models from custom endpoint")
                .onClick(async () => {
                    if (!this.plugin.settings.providers.custom.baseUrl) {
                        new Notice("Please enter an API base URL first");
                        return;
                    }
                    
                    new Notice("Fetching available models...");
                    try {
                        const freshModels = await this.fetchModelsForProvider('custom');
                        if (freshModels && freshModels.length > 0) {
                            new Notice(`Found ${freshModels.length} models from custom endpoint`);
                        } else {
                            new Notice("No models found. Check your API configuration.");
                        }
                        // Refresh the display
                        this.display();
                    } catch (error) {
                        console.error("Failed to fetch models:", error);
                        new Notice("Failed to fetch models. Check console for details.");
                    }
                });
            });
            
        if (models && models.length > 0) {
            // Show dropdown if we have models
            modelSetting.addDropdown((dropdown) => {
                models.forEach(model => {
                    dropdown.addOption(model.id, model.id);
                });
                
                dropdown.setValue(this.plugin.settings.engine || (models[0]?.id || ""))
                    .onChange(async (value) => {
                        this.plugin.settings.engine = value;
                        await this.plugin.saveSettings();
                    });
            });
        } else {
            // Fallback to text input
            const placeholder = fetchError 
                ? "Failed to fetch models, enter model name manually" 
                : "Enter model name";
                
            modelSetting.addText((text) =>
                text
                    .setPlaceholder(placeholder)
                    .setValue(this.plugin.settings.engine)
                    .onChange(async (value) => {
                        this.plugin.settings.engine = value;
                        await this.plugin.saveSettings();
                    })
            );
        }
    }
    
    displayCommonSettings(): void {
        const { containerEl } = this;
        
        // Temperature
        new Setting(containerEl)
            .setName("Temperature")
            .setDesc("Controls randomness (0-1)")
            .addSlider(slider => 
                slider
                    .setLimits(0, 1, 0.1)
                    .setValue(this.plugin.settings.temperature)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.temperature = value;
                        await this.plugin.saveSettings();
                    })
            );

    }
}


