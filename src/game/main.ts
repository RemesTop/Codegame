import { Game as MainGame } from './scenes/Game';
import { AUTO, Game, Types } from 'phaser';

// Find out more information about the Game Config at:
// https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Types.Core.GameConfig = {
    type: AUTO,
    width: 1024,
    height: 832,
    parent: 'game-container',
    backgroundColor: '#2ea9ef',
    roundPixels: true,
    render: {
        antialias: true,
        mipmapFilter: 'LINEAR_MIPMAP_LINEAR',
    },
    scene: [MainGame],
    physics: {
        default: 'arcade',
        arcade: {
            tileBias: 32,
            overlapBias: 16,
            gravity: {
                x: 0,
                y: 1400,
            },
        },
    },
};

const StartGame = (parent: string) => {
    return new Game({ ...config, parent });
};

export default StartGame;
