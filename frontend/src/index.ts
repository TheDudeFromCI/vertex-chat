import './css/global.css'

import { App } from './App.js'

const app = new App()
const div = app.build()
document.body.appendChild(div)

void app.reloadWorkspaces()
void app.reloadPersonas()
