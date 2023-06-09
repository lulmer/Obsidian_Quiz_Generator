import { App, Editor, MarkdownView, request, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import {QuizGeneratorSettings,Context} from './types';
import { openFile, createFileWithInput} from 'src/utils';
import QuizGenerator from './quiz_generator';
import {SetPath } from './set_path'
import safeAwait from 'safe-await'
import ReqFormatter from './req_formatter';

import debug from "debug";
const logger = debug('textgenerator:main');

// Remember to rename these classes and interfaces!

const DEFAULT_SETTINGS: QuizGeneratorSettings= {
	api_key: "",
	engine: "gpt-3.5-turbo",
	max_tokens: 1000,
	temperature: 0.7,
	frequency_penalty: 0.5,
	prompt: "",
	system_prompt : "You are a quiz generator, you will be feed an input with the flag [INPUT] and you will give 5 set of question/answer based uniquely on this input in the following json format \:\" [OUTPUT]{\"Questions\" : [{ \"question\" : \"Where was the pyramids ?\",\n \"answer\" : \"In Egypt.\", \n \"line\" : \"4-5\" }, ... ]} }\". In a json, the attribute name MUST be '\"' and not '\''. All the questions must have their response in the input text, don't add additional information. Forget every exterior knowledge. Note that the [INPUT] is a written in markdown, hence the OUTPUT.answers have to be compatible to markdown. Don't forget that this character : \'\\\' is strictly banned and you must write it as \"\\\\\"",
	n_questions : 5,
	showStatusBar: true,
	outputToBlockQuote: false,
	promptsPath:"textgenerator/prompts",
	context:{
		includeTitle:false,
		includeStaredBlocks:true,
		includeFrontmatter:true,
		includeHeadings:true,
		includeChildren:false,
		includeMentions:false,
		includeHighlights:true
	},
	options:
	{
		"generate-text": true,
		"generate-text-with-metadata": true,
		"insert-generated-text-From-template": true,
		"create-generated-text-From-template": false,
		"insert-text-From-template": false,
		"create-text-From-template": false,
		"show-model-From-template": true,
		"set_max_tokens": true,
		"set-model": true,
		"packageManager": true,
		"create-template": false,
		"get-title": true,
		"auto-suggest": false,
		"generated-text-to-clipboard-From-template": false,
	},
	autoSuggestOptions: {
		status: true,
		delay: 300,
		numberOfSuggestions: 5,
		triggerPhrase: "  ",
		stop: ".",
		showStatus: true
	},
	displayErrorInEditor: false
}

export default class QuizGenPlugin extends Plugin {
	settings: QuizGeneratorSettings;
	defaultSettings:QuizGeneratorSettings;
	processing: true;
	//TODO : Give the file where the cursor is (Not necessary) -> clear
	getActiveView() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView !== null) {
            return activeView
        } else {
            new Notice("The file type should be Markdown!");
            return null
        }
    }

	async onload() {
		this.defaultSettings = DEFAULT_SETTINGS;
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Quiz Generator', async (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			const activeFile = this.app.workspace.getActiveFile();
			const activeView = this.getActiveView();
			console.log(activeView)
			if (activeView !== null) {
			const editor = activeView.editor;
			}
			console.log("Creating the questions ...")
			var quizgen = new QuizGenerator(this.app, this)

			var title;
			if (activeFile !== null){
				console.log('OK')
				title = `${activeFile.basename} Quiz`;
			}


			else{
				logger('You have to select a file.');
				title = "NewQuiz";
			}
			const response = await quizgen.generate(title)
			const content = "# Generated Quiz\n\n#flashcards\n" + response
			console.log(title)
			const suggestedPath = `${title}.md`

			//Open a new note and write string
			new SetPath(this.app,suggestedPath,async (path: string) => {
				const [errorFile,file]= await safeAwait(createFileWithInput(path,content,this.app));
				if(errorFile) {
					logger("createTemplate error",errorFile);
					return Promise.reject(errorFile);
				}
				openFile(this.app,file);
			  }).open(); 
			
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: QuizGenPlugin;

	constructor(app: App, plugin: QuizGenPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings the Awesome Quiz Generator Plugin.'});

		new Setting(containerEl)
			.setName('Api Key')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your Open AI API key')
				.setValue(this.plugin.settings.api_key)
				.onChange(async (value) => {
					console.log('Secret: ' + value);
					this.plugin.settings.api_key = value;
					await this.plugin.saveSettings();
				}));
		//TODO : Slider is not really intuitive ...
		new Setting(containerEl)
				.setName('Number of questions')
				.setDesc('Indicates the number of questions you want to generate')
				.addSlider(n => n 
					.setLimits(1,20,1)
					.setValue(this.plugin.settings.n_questions)
					.onChange(async (value) => {
						console.log('Secret: ' + value);
						this.plugin.settings.n_questions = value;
						await this.plugin.saveSettings();
					})
					.setDynamicTooltip()
					)
				
	}
}
