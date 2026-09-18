'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const Fastify = require('../fastify')

function postChunked (port, contentType, chunk, times) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, method: 'POST', path: '/ingest', headers: { 'content-type': contentType } }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ statusCode: res.statusCode, body }))
    })
    req.on('error', reject)
    for (let i = 0; i < times; i++) req.write(chunk)
    req.end()
  })
}

function build (t, bodyLimit) {
  const fastify = Fastify({ bodyLimit })
  t.after(() => fastify.close())
  let consumed = 0
  fastify.addContentTypeParser('application/x-ndjson', function (req, stream, done) {
    stream.on('data', c => { consumed += c.length })
    stream.on('end', () => done(null, { consumed }))
    stream.on('error', err => done(err))
  })
  fastify.post('/ingest', async (req) => ({ bytes: req.body.consumed }))
  return { fastify, port: () => fastify.server.address().port }
}

test('流式自定义 parser 超过 bodyLimit 必须返回 413', async (t) => {
  const { fastify, port } = build(t, 1024)
  await fastify.listen({ port: 0 })
  const res = await postChunked(port(), 'application/x-ndjson', 'x'.repeat(512) + '\n', 20)
  assert.strictEqual(res.statusCode, 413, '40KB 请求体被完整放行，bodyLimit 对自定义 parser 没生效：' + res.body)
  assert.strictEqual(JSON.parse(res.body).code, 'FST_ERR_CTP_BODY_TOO_LARGE')
})

test('未超过 bodyLimit 的流式 parser 请求仍然正常', async (t) => {
  const { fastify, port } = build(t, 1024)
  await fastify.listen({ port: 0 })
  const res = await postChunked(port(), 'application/x-ndjson', 'x'.repeat(256) + '\n', 3)
  assert.strictEqual(res.statusCode, 200, res.body)
})

test('内置 JSON parser 的 bodyLimit 行为不受影响', async (t) => {
  const fastify = Fastify({ bodyLimit: 1024 })
  t.after(() => fastify.close())
  fastify.post('/ingest', async () => ({ ok: true }))
  await fastify.listen({ port: 0 })
  const res = await postChunked(fastify.server.address().port, 'application/json', JSON.stringify({ a: 'x'.repeat(4096) }), 1)
  assert.strictEqual(res.statusCode, 413)
})
