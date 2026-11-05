import { useRef } from 'react';
import * as Phaser from 'phaser';
import { IRefPhaserGame, PhaserGame } from './PhaserGame';
import { Editor } from './Editor';

function App() {
    const phaserRef = useRef<IRefPhaserGame | null>(null);

    const addSprite = () => {
        const scene = phaserRef.current?.scene;
        if (!scene) return;

        const x = Phaser.Math.Between(64, scene.scale.width - 64);
        const y = Phaser.Math.Between(64, scene.scale.height - 64);
        scene.add.sprite(x, y, 'star');
    };

    return (
        <div id="app">
            <div className="game-view">
                <PhaserGame ref={phaserRef} />
                <div className="controls">
                    <button className="button" onClick={addSprite}>Add New Sprite</button>
                </div>
            </div>
            <div className="editor-view">
                <Editor />
            </div>
        </div>
    );
}

export default App;
