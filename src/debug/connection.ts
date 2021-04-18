import * as net from 'net'
import { fromEvent, Observable } from 'rxjs'
import { ByebugConnected } from './events'

export type Command = 'help' | 'step' | 'restart' | 'next' | 'continue'
export type EventType = ByebugConnected

export function createConnection(
  socket: net.Socket,
  onEntry = true,
  opts: net.SocketConnectOpts = { host: '127.0.0.1', port: 12345, family: 6 }
): Observable<EventType> {
  const socketObservable = new Observable<EventType>(subscribe => {
    const source = socket
    let chunks: Buffer[] = []

    const dataSubscription = fromEvent<Buffer>(source, 'data').subscribe(
      data => {
        chunks.push(data)

        if (data.indexOf('PROMPT') === 0) {
          subscribe.next(Buffer.concat(chunks))

          chunks = []
        }
      }
    )

    const errorSubscription = fromEvent<Error>(source, 'error').subscribe(e => {
      subscribe.error(e)
    })

    const closeSubscription = fromEvent<boolean>(source, 'close').subscribe(
      hadError => {
        subscribe.complete()
      }
    )

    const readySubscription = fromEvent(source, 'ready').subscribe(() => {
      subscribe.next(new ByebugConnected())
    })

    socket.connect(opts)

    subscribe.add(() => source._destroy)
    subscribe.add(closeSubscription.unsubscribe)
    subscribe.add(errorSubscription.unsubscribe)
    subscribe.add(dataSubscription.unsubscribe)
    subscribe.add(readySubscription.unsubscribe)
  })

  return socketObservable
}
