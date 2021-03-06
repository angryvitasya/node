// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';
const common = require('../common');
const assert = require('assert');
const http = require('http');
const Agent = require('_http_agent').Agent;

let name;

const agent = new Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 5,
  maxFreeSockets: 5
});

const server = http.createServer(function(req, res) {
  if (req.url === '/error') {
    res.destroy();
    return;
  } else if (req.url === '/remote_close') {
    // cache the socket, close it after a short delay
    const socket = res.connection;
    setImmediate(function() {
      socket.end();
    });
  }
  res.end('hello world');
});

function get(path, callback) {
  return http.get({
    host: 'localhost',
    port: server.address().port,
    agent: agent,
    path: path
  }, callback);
}

function checkDataAndSockets(body) {
  assert.strictEqual(body.toString(), 'hello world');
  assert.strictEqual(agent.sockets[name].length, 1);
  assert.strictEqual(agent.freeSockets[name], undefined);
}

function second() {
  // request second, use the same socket
  get('/second', function(res) {
    assert.strictEqual(res.statusCode, 200);
    res.on('data', checkDataAndSockets);
    res.on('end', function() {
      assert.strictEqual(agent.sockets[name].length, 1);
      assert.strictEqual(agent.freeSockets[name], undefined);
      process.nextTick(function() {
        assert.strictEqual(agent.sockets[name], undefined);
        assert.strictEqual(agent.freeSockets[name].length, 1);
        remoteClose();
      });
    });
  });
}

function remoteClose() {
  // mock remote server close the socket
  get('/remote_close', function(res) {
    assert.deepStrictEqual(res.statusCode, 200);
    res.on('data', checkDataAndSockets);
    res.on('end', function() {
      assert.strictEqual(agent.sockets[name].length, 1);
      assert.strictEqual(agent.freeSockets[name], undefined);
      process.nextTick(function() {
        assert.strictEqual(agent.sockets[name], undefined);
        assert.strictEqual(agent.freeSockets[name].length, 1);
        // waitting remote server close the socket
        setTimeout(function() {
          assert.strictEqual(agent.sockets[name], undefined);
          assert.strictEqual(agent.freeSockets[name], undefined,
                             'freeSockets is not empty');
          remoteError();
        }, common.platformTimeout(200));
      });
    });
  });
}

function remoteError() {
  // remove server will destroy ths socket
  const req = get('/error', function(res) {
    throw new Error('should not call this function');
  });
  req.on('error', function(err) {
    assert.ok(err);
    assert.strictEqual(err.message, 'socket hang up');
    assert.strictEqual(agent.sockets[name].length, 1);
    assert.strictEqual(agent.freeSockets[name], undefined);
    // Wait socket 'close' event emit
    setTimeout(function() {
      assert.strictEqual(agent.sockets[name], undefined);
      assert.strictEqual(agent.freeSockets[name], undefined);
      done();
    }, common.platformTimeout(1));
  });
}

function done() {
  console.log('http keepalive agent test success.');
  process.exit(0);
}

server.listen(0, function() {
  name = `localhost:${server.address().port}:`;
  // request first, and keep alive
  get('/first', function(res) {
    assert.strictEqual(res.statusCode, 200);
    res.on('data', checkDataAndSockets);
    res.on('end', function() {
      assert.strictEqual(agent.sockets[name].length, 1);
      assert.strictEqual(agent.freeSockets[name], undefined);
      process.nextTick(function() {
        assert.strictEqual(agent.sockets[name], undefined);
        assert.strictEqual(agent.freeSockets[name].length, 1);
        second();
      });
    });
  });
});
