"use client";

import { useState, useRef, useEffect } from "react";
import TopBar from "./top-bar";
import { Send, Paperclip, Smile } from "lucide-react";
import Image from "next/image";
import LoadingDots from "./loading-dots";
import { motion, AnimatePresence } from "framer-motion";

type Message = {
  id: string;
  text: string;
  sender: "user" | "bot";
  timestamp: Date;
};

const FAQ_QUESTIONS = [
  "When does admissions open for intermediate?",
  "Can I submit my admission application online?",
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      text: "Hi I'm KBot. How can I help you?",
      sender: "bot",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
    fetch(`${API_URL}/sessions/new`, { method: "POST" })
      .then((res) => res.json())
      .then((data) => setSessionId(data.session_id))
      .catch(console.error);
  }, []);

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text,
      sender: "user",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    const botId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: botId, text: "", sender: "bot", timestamp: new Date() },
    ]);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, session_id: sessionId }),
      });

      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) => (m.id === botId ? { ...m, text: m.text + chunk } : m))
        );
      }
    } catch (error) {
      console.error("Error fetching response:", error);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId
            ? { ...m, text: "Sorry, I couldn't process your request. Please try again." }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <TopBar />

      <div className="flex-1 overflow-y-auto pt-16 pb-[15rem] px-4 bg-[rgb(255,220,220)]">
        <div className="max-w-3xl mx-auto">
          <div className="space-y-6 py-4">
            <AnimatePresence>
              {messages.map((message, index) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="message-appear"
                >
                  <div
                    className={`flex ${
                      message.sender === "user" ? "justify-end" : "justify-start"
                    } mb-1`}
                  >
                    <p
                      className={`text-xs font-medium ${
                        message.sender === "user" ? "text-gray-500 mr-2" : "text-[#8f0e0e] ml-12"
                      }`}
                    >
                      {message.sender === "user" ? "You" : "KBot"}
                    </p>
                  </div>

                  <div
                    className={`flex items-start ${
                      message.sender === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    {message.sender === "bot" && (
                      <div className="flex-shrink-0 mr-3">
                        <div className="w-10 h-10 rounded-full border-2 border-[rgb(143,14,14)] flex items-center justify-center shadow-md">
                          <Image
                            src="bot.png"
                            alt="Bot"
                            width={24}
                            height={24}
                            className="w-6 h-6"
                          />
                        </div>
                      </div>
                    )}

                    <div
                      className={`py-3 px-4 rounded-2xl max-w-[80%] shadow-sm ${
                        message.sender === "user"
                          ? "bg-white border border-gray-200 text-gray-800"
                          : "bg-[#8f0e0e] text-white"
                      }`}
                    >
                      {message.text}
                    </div>
                  </div>
                </motion.div>
              ))}

              <AnimatePresence>{isLoading && <LoadingDots />}</AnimatePresence>
            </AnimatePresence>

            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      <div className="fixed bottom-20 left-0 right-0 flex justify-center px-4 py-3 bg-[rgb(255,220,220)]">
        <div className="flex flex-wrap justify-center gap-2 w-full max-w-3xl">
          {FAQ_QUESTIONS.map((question, index) => (
            <motion.button
              key={index}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => handleSendMessage(question)}
              className="bg-white border border-gray-200 rounded-full py-2 px-4 text-sm font-medium text-gray-700 hover:bg-[#8f0e0e] hover:text-white hover:border-transparent transition-all duration-200 shadow-sm hover:shadow btn-pulse"
            >
              {question}
            </motion.button>
          ))}
        </div>
      </div>

      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg"
      >
        <div className="flex items-center max-w-3xl mx-auto">
          <button className="text-gray-400 hover:text-[#8f0e0e] mr-2 transition-colors">
            <Paperclip size={20} />
          </button>
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(inputValue);
                }
              }}
              placeholder="Type your query here..."
              className="w-full py-3 px-4 rounded-full border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#8f0e0e] focus:border-transparent bg-gray-50 pr-10"
            />
            <button className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-[#8f0e0e] transition-colors">
              <Smile size={20} />
            </button>
          </div>
          <button
            onClick={() => handleSendMessage(inputValue)}
            disabled={!inputValue.trim() || isLoading}
            className={`ml-2 rounded-full w-10 h-10 flex items-center justify-center transition-colors ${
              !inputValue.trim() || isLoading
                ? "bg-gray-200 text-gray-400"
                : "bg-[#8f0e0e] text-white hover:bg-[#a51212]"
            }`}
          >
            <Send size={18} />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
