import { useEffect, useRef } from 'react';

declare global {
    interface Window {
        require: any;
        monaco: any;
    }
}

interface EditorProps {
    defaultValue?: string;
    onChange?: (value: string) => void;
}

export function Editor({ defaultValue = '', onChange }: EditorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<any>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        if (!containerRef.current) return;

        const init = () => {
            window.require.config({
                paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' },
            });

            window.require(['vs/editor/editor.main'], () => {
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

                window.monaco.languages.typescript.javascriptDefaults.addExtraLib(
                    gameApiDefs,
                    'ts:filename/game-api.d.ts'
                );

                editorRef.current = window.monaco.editor.create(containerRef.current, {
                    value: defaultValue,
                    language: 'javascript',
                    theme: 'vs-dark',
                    automaticLayout: true,
                    minimap: { enabled: false },
                    fontSize: 14,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                });

                editorRef.current.onDidChangeModelContent(() => {
                    onChangeRef.current?.(editorRef.current.getValue());
                });
            });
        };

        if (window.require) {
            init();
        } else {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js';
            script.async = true;
            script.onload = init;
            document.head.appendChild(script);
        }

        return () => {
            if (editorRef.current) {
                editorRef.current.dispose();
                editorRef.current = null;
            }
        };
    }, []);

    return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
