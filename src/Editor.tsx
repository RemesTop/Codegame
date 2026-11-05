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

const PLACEHOLDER = `// Game script
function update() {
    
}

function start() {

}
`;

export function Editor({ defaultValue = PLACEHOLDER, onChange }: EditorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<any>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const init = () => {
            window.require.config({
                paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' },
            });

            window.require(['vs/editor/editor.main'], () => {
                if (!containerRef.current || editorRef.current) return;

                editorRef.current = window.monaco.editor.create(containerRef.current, {
                    value: defaultValue,
                    language: 'javascript',
                    theme: 'vs-dark',
                    automaticLayout: true,
                    minimap: { enabled: false },
                    fontSize: 14,
                });

                if (onChange) {
                    editorRef.current.onDidChangeModelContent(() => {
                        onChange(editorRef.current.getValue());
                    });
                }
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

