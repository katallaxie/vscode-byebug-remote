import { Observable, fromEvent } from 'rxjs'
import * as net from 'net'

export const fromPrompt = (
  socket: net.Socket,
  cmd: string | null = null
): Observable<Buffer> => {
  return new Observable<Buffer>(subscribe => {
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

    subscribe.add(dataSubscription.unsubscribe)

    if (cmd !== null) {
      source.write(`${cmd}\n`)
    }
  })
}
