import { Observable, Observer } from 'rxjs'
import * as net from 'net'
import { NodeEventHandler } from 'rxjs/internal/observable/fromEvent'

export const fromPrompt = (
  socket: net.Socket,
  cmd: string
): Observable<string> => {
  return new Observable<string>(subscriber => {
    function handler(e: Buffer) {
      const res = e.toString()

      subscriber.next(e.toString())

      if (res.indexOf('PROMPT') === 0) {
        subscriber.complete()

        return
      }

      subscriber.error('did not get a new prompt')
    }

    const source = socket
    socket.addListener('data', handler as NodeEventHandler)
    socket.addListener('error', err => subscriber.error(err))
    const unsubscribe = () =>
      source.removeListener('data', handler as NodeEventHandler)

    subscriber.add(unsubscribe)

    source.write(`${cmd}\n`)
  })
}
