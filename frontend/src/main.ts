import './style.css';

import { ChatApp } from './app/chat_app';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
    throw new Error('App root not found');
}

const chatApp = new ChatApp(app);
chatApp.start();
