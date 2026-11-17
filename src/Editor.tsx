import { useEffect, useRef } from "react";

declare global {
    interface Window {
        require: any;
        monaco: any;
    }
}

interface EditorProps {
    defaultValue?: string;
    value?: string;
    onChange?: (value: string) => void;
}

export function Editor({ defaultValue = "", value, onChange }: EditorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<any>(null);
    const providersRef = useRef<any[]>([]);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        if (!containerRef.current) return;

        const init = () => {
            window.require.config({
                paths: {
                    vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs",
                },
            });

            window.require(["vs/editor/editor.main"], () => {
                if (!containerRef.current || editorRef.current) return;

                // Register in-game API autocomplete definitions for Monaco JavaScript language service
                const gameApiDefs = `
/**
 * Moves the character to the right continuously.
 */
declare function moveRight(): void;

/**
 * Moves the character to the left continuously.
 */
declare function moveLeft(): void;

/**
 * Stops all horizontal movement.
 */
declare function stop(): void;

/**
 * Displays and tracks a variable in the top-right corner of the game view.
 * Call once during initialization to automatically track value changes on each tick.
 * 
 * @param variable The variable or label to track (e.g. track(counter)).
 * @param value Optional explicit value or custom label.
 */
declare function track(variable: any, value?: any): void;

/**
 * Pauses execution for the specified number of milliseconds.
 * Can be called directly without needing manual async/await.
 * 
 * @param ms Duration to sleep in milliseconds.
 */
declare function sleep(ms: number): Promise<void>;
`;

                // Clean up any previously registered providers or extra libs
                providersRef.current.forEach((p) => p.dispose());
                providersRef.current = [];

                const extraLibDisposable =
                    window.monaco.languages.typescript.javascriptDefaults.addExtraLib(
                        gameApiDefs,
                        "ts:filename/game-api.d.ts",
                    );

                // Register custom hover provider so hovering over 'function start()' or 'function update()'
                // displays clear documentation even though the user is declaring their own function
                const hoverProvider =
                    window.monaco.languages.registerHoverProvider(
                        "javascript",
                        {
                            provideHover: (model: any, position: any) => {
                                const word = model.getWordAtPosition(position);
                                if (!word) return null;

                                const lineContent = model.getLineContent(
                                    position.lineNumber,
                                );

                                // Do not show lifecycle hover docs inside line comments
                                const commentIdx = lineContent.indexOf("//");
                                if (
                                    commentIdx !== -1 &&
                                    position.column > commentIdx + 1
                                ) {
                                    return null;
                                }

                                // Check that the word is being used as a function (declaration or call)
                                const isFunctionRef = new RegExp(
                                    `(?:\\bfunction\\s+)?\\b${word.word}\\s*\\(`,
                                ).test(lineContent);
                                if (!isFunctionRef) return null;

                                if (word.word === "start") {
                                    return {
                                        range: new window.monaco.Range(
                                            position.lineNumber,
                                            word.startColumn,
                                            position.lineNumber,
                                            word.endColumn,
                                        ),
                                        contents: [
                                            {
                                                value: "**function start()** *(optional)*",
                                            },
                                            {
                                                value: "Optional initialization function that runs exactly once when you press **Run**, before the repeating `update()` tick loop begins.",
                                            },
                                        ],
                                    };
                                }

                                if (word.word === "update") {
                                    return {
                                        range: new window.monaco.Range(
                                            position.lineNumber,
                                            word.startColumn,
                                            position.lineNumber,
                                            word.endColumn,
                                        ),
                                        contents: [
                                            { value: "**function update()**" },
                                            {
                                                value: "Main game loop function that runs repeatedly every **100 milliseconds** (10 times every second).",
                                            },
                                        ],
                                    };
                                }

                                return null;
                            },
                        },
                    );

                // Snippet completions for function start and function update
                const completionProvider =
                    window.monaco.languages.registerCompletionItemProvider(
                        "javascript",
                        {
                            provideCompletionItems: (
                                model: any,
                                position: any,
                            ) => {
                                const word =
                                    model.getWordUntilPosition(position);
                                const range = {
                                    startLineNumber: position.lineNumber,
                                    endLineNumber: position.lineNumber,
                                    startColumn: word.startColumn,
                                    endColumn: word.endColumn,
                                };
                                return {
                                    suggestions: [
                                        {
                                            label: "function start",
                                            kind: window.monaco.languages
                                                .CompletionItemKind.Snippet,
                                            insertText:
                                                "function start() {\n\t$0\n}",
                                            insertTextRules:
                                                window.monaco.languages
                                                    .CompletionItemInsertTextRule
                                                    .InsertAsSnippet,
                                            documentation:
                                                "Optional initialization function that runs once before update().",
                                            range,
                                        },
                                        {
                                            label: "function update",
                                            kind: window.monaco.languages
                                                .CompletionItemKind.Snippet,
                                            insertText:
                                                "function update() {\n\t$0\n}",
                                            insertTextRules:
                                                window.monaco.languages
                                                    .CompletionItemInsertTextRule
                                                    .InsertAsSnippet,
                                            documentation:
                                                "Main game loop function that runs repeatedly every 100 milliseconds.",
                                            range,
                                        },
                                    ],
                                };
                            },
                        },
                    );

                providersRef.current.push(
                    extraLibDisposable,
                    hoverProvider,
                    completionProvider,
                );

                editorRef.current = window.monaco.editor.create(
                    containerRef.current,
                    {
                        value: defaultValue,
                        language: "javascript",
                        theme: "vs-dark",
                        automaticLayout: true,
                        minimap: { enabled: false },
                        fontSize: 14,
                        lineNumbers: "on",
                        scrollBeyondLastLine: false,
                    },
                );

                editorRef.current.onDidChangeModelContent(() => {
                    onChangeRef.current?.(editorRef.current.getValue());
                });
            });
        };

        let loaderScript: HTMLScriptElement | null = null;

        if (window.require) {
            init();
        } else {
            loaderScript = document.querySelector(
                "script[data-monaco-loader]",
            ) as HTMLScriptElement | null;
            if (!loaderScript) {
                loaderScript = document.createElement("script");
                loaderScript.src =
                    "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js";
                loaderScript.async = true;
                loaderScript.setAttribute("data-monaco-loader", "true");
                document.head.appendChild(loaderScript);
            }
            loaderScript.addEventListener("load", init);
        }

        return () => {
            if (loaderScript) {
                loaderScript.removeEventListener("load", init);
            }
            providersRef.current.forEach((p) => p.dispose());
            providersRef.current = [];
            if (editorRef.current) {
                editorRef.current.dispose();
                editorRef.current = null;
            }
        };
    }, []);

    // Change value of the editor externally (for the reset button)
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor || value === undefined || value === editor.getValue())
            return;

        editor.executeEdits("external-update", [
            { range: editor.getModel().getFullModelRange(), text: value },
        ]);
        editor.pushUndoStop();
    }, [value]);

    return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

