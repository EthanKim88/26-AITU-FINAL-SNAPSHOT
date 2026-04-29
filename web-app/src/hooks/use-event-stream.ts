"use client";

import { useState, useEffect, useRef } from "react";

interface EventData {
  id: string; type: string; category: string; source: string;
  message: string; data: string; host: string; createdAt: string;
}

export function useEventStream() {
  const [events, setEvents] = useState<EventData[]>([]);
  const lastIdRef = useRef("");

  useEffect(() => {
    const url = `/api/events/stream${lastIdRef.current ? `?lastId=${lastIdRef.current}` : ""}`;
    const es = new EventSource(url);

    es.onmessage = (e) => {
      try {
        const newEvents = JSON.parse(e.data) as EventData[];
        if (newEvents.length > 0) {
          lastIdRef.current = newEvents[newEvents.length - 1].id;
          setEvents((prev) => [...newEvents, ...prev]);
        }
      } catch { /* heartbeat or parse error */ }
    };

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, []);

  return events;
}
