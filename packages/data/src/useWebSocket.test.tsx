/** @jsxImportSource @termuijs/jsx */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@termuijs/testing'
import { useState } from '@termuijs/jsx'
import { useWebSocket } from './hooks.js'


// We keep track of all created sockets so our tests can trigger events on them
let activeSockets: MockWebSocket[] = []

class MockWebSocket {
    url: string
    readyState = 0 // 0: CONNECTING, 1: OPEN, 2: CLOSING, 3: CLOSED
    
    // Event listeners that the hook will attach
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onmessage: ((event: { data: any }) => void) | null = null
    onerror: (() => void) | null = null
    
    sentData: any[] = []
    isClosed = false

    constructor(url: string) {
        this.url = url
        activeSockets.push(this)
    }

    send(data: any) {
        this.sentData.push(data)
    }

    close() {
        this.isClosed = true
        this.readyState = 3
    }
}

describe('useWebSocket hook', () => {
    beforeEach(() => {
        // Reset our tracker before every test
        activeSockets = []
        // Intercept global WebSocket and replace with our mock
        vi.stubGlobal('WebSocket', MockWebSocket)
        // Take control of setTimeout
        vi.useFakeTimers() 
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    // We need a dummy component to execute the hook
    function TestComponent({ url }: { url: string }) {
        const { state, message, send } = useWebSocket(url)
        
        // We attach the hook's output to a global object so the test can read it
        ;(global as any).hookResult = { state, message, send }
        
        return null 
    }

    it('exposes the default state and connects', () => {
        render(<TestComponent url="wss://test.com" />)
        
        const result = (global as any).hookResult
        expect(result.state).toBe('connecting')
        expect(result.message).toBeNull()
        expect(activeSockets.length).toBe(1)
        expect(activeSockets[0].url).toBe('wss://test.com')
    })

    it('updates state on open and receives messages', async () => {
        render(<TestComponent url="wss://test.com" />)
        const socket = activeSockets[0]

        // Simulate a successful connection
        socket.onopen?.()
        await Promise.resolve() // Flush the microtask queue so state updates
        expect((global as any).hookResult.state).toBe('open')

        // Simulate the server sending a message
        socket.onmessage?.({ data: 'Hello TermUI' })
        await Promise.resolve() // Flush the microtask queue so state updates
        expect((global as any).hookResult.message).toBe('Hello TermUI')
    })

    it('reconnects after a drop using exponential backoff', async () => {
        render(<TestComponent url="wss://test.com" />)
        let socket = activeSockets[0]

        // Connect successfully first
        socket.onopen?.()
        await Promise.resolve()
        
        // Simulate a dropped connection
        socket.onclose?.()
        await Promise.resolve()
        expect((global as any).hookResult.state).toBe('closed')

        // At this exact moment, it should NOT have reconnected yet
        expect(activeSockets.length).toBe(1)

        // Fast-forward time by 1 second (1000ms) asynchronously
        await vi.advanceTimersByTimeAsync(1000) 
        
        // Now it should have created a second socket to retry
        expect(activeSockets.length).toBe(2)
        expect((global as any).hookResult.state).toBe('connecting')
    })

    it('closes the socket when the component unmounts', () => {
        const { unmount } = render(<TestComponent url="wss://test.com" />)
        const socket = activeSockets[0]

        expect(socket.isClosed).toBe(false)
        
        // Destroy the component
        unmount()
        
        // The cleanup function should have fired
        expect(socket.isClosed).toBe(true)
    })

    it('handles URL changes correctly without leaking sockets or triggering stale reconnects', async () => {
        function ParentComponent() {
            const [url, setUrl] = useState('wss://first.com')
            ;(global as any).setUrl = setUrl
            return <TestComponent url={url} />
        }

        render(<ParentComponent />)
        expect(activeSockets.length).toBe(1)
        const firstSocket = activeSockets[0]

        // Connect successfully first
        firstSocket.onopen?.()
        await Promise.resolve()

        // Change URL via parent component state update
        const setUrl = (global as any).setUrl
        setUrl('wss://second.com')
        await Promise.resolve() // Flush microtasks to run effects

        // The first socket should be closed by cleanup
        expect(firstSocket.isClosed).toBe(true)
        expect(activeSockets.length).toBe(2)
        const secondSocket = activeSockets[1]
        expect(secondSocket.url).toBe('wss://second.com')

        // Simulate first socket closing event firing after URL change
        firstSocket.onclose?.()
        await vi.advanceTimersByTimeAsync(1000)

        // It should NOT trigger any new connection (no reconnect for the stale socket)
        expect(activeSockets.length).toBe(2)
    })

    it('handles rapid URL changes (3+ in sequence) correctly', async () => {
        function ParentComponent() {
            const [url, setUrl] = useState('wss://1.com')
            ;(global as any).setUrl = setUrl
            return <TestComponent url={url} />
        }

        render(<ParentComponent />)
        expect(activeSockets.length).toBe(1)
        const s1 = activeSockets[0]

        const setUrl = (global as any).setUrl

        // Change to URL 2
        setUrl('wss://2.com')
        await Promise.resolve()
        expect(s1.isClosed).toBe(true)
        expect(activeSockets.length).toBe(2)
        const s2 = activeSockets[1]

        // Change to URL 3
        setUrl('wss://3.com')
        await Promise.resolve()
        expect(s2.isClosed).toBe(true)
        expect(activeSockets.length).toBe(3)
        const s3 = activeSockets[2]

        // Change to URL 4
        setUrl('wss://4.com')
        await Promise.resolve()
        expect(s3.isClosed).toBe(true)
        expect(activeSockets.length).toBe(4)
        const s4 = activeSockets[3]
        expect(s4.url).toBe('wss://4.com')

        // Ensure old socket close events do not trigger reconnects
        s1.onclose?.()
        s2.onclose?.()
        s3.onclose?.()
        await vi.advanceTimersByTimeAsync(2000)

        expect(activeSockets.length).toBe(4)
        expect(s4.isClosed).toBe(false)
    })

    it('handles immediate unmount after mount', () => {
        const { unmount } = render(<TestComponent url="wss://test.com" />)
        expect(activeSockets.length).toBe(1)
        const socket = activeSockets[0]

        unmount()
        expect(socket.isClosed).toBe(true)
    })

    it('handles error recovery by closing socket and scheduling reconnect', async () => {
        render(<TestComponent url="wss://test.com" />)
        expect(activeSockets.length).toBe(1)
        const socket = activeSockets[0]

        // Simulate error
        socket.onerror?.()
        await Promise.resolve()

        // onerror should call close() which triggers onclose and schedules reconnect
        expect(socket.isClosed).toBe(true)

        // Trigger onclose
        socket.onclose?.()
        await Promise.resolve()

        // Wait for reconnect timer (1000ms)
        await vi.advanceTimersByTimeAsync(1000)
        expect(activeSockets.length).toBe(2)
        expect(activeSockets[1].url).toBe('wss://test.com')
    })

    it('clears scheduled reconnect timer when unmounted during retry backoff', async () => {
        const { unmount } = render(<TestComponent url="wss://test.com" />)
        const socket = activeSockets[0]

        // Trigger close to schedule reconnect
        socket.onclose?.()
        await Promise.resolve()

        // Unmount before reconnect timer fires
        unmount()

        // Advance timers past reconnect delay
        await vi.advanceTimersByTimeAsync(2000)

        // No new socket should have been created
        expect(activeSockets.length).toBe(1)
    })
})