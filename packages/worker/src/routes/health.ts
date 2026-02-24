import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'orquestra-api',
  })
})

app.get('/ping', (c) => {
  return c.text('pong')
})

export default app
