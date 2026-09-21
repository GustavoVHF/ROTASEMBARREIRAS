"use client";

import React from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";

interface PrivacyPolicySheetProps {
  isOpen: boolean;
  onClose: () => void;
}

const LAST_UPDATE = "20 de setembro de 2026";

export default function PrivacyPolicySheet({ isOpen, onClose }: PrivacyPolicySheetProps) {
  const { preferences } = useAuth();
  const reduceMotion = preferences?.reduce_motion_enabled ?? false;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            initial={reduceMotion ? { opacity: 0.3 } : { opacity: 0 }}
            animate={{ opacity: 0.3 }}
            exit={reduceMotion ? { opacity: 0.3 } : { opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : undefined}
            onClick={onClose}
            className="fixed inset-0 bg-black z-30 pointer-events-auto"
          />

          {/* Bottom Sheet */}
          <motion.div
            initial={reduceMotion ? { y: 0 } : { y: "100%" }}
            animate={{ y: 0 }}
            exit={reduceMotion ? { y: 0 } : { y: "100%" }}
            transition={reduceMotion ? { duration: 0 } : { type: "spring", damping: 25, stiffness: 220 }}
            className="fixed bottom-0 left-0 right-0 z-40 bg-white rounded-t-[32px] shadow-[0_-8px_30px_rgba(0,0,0,0.08)] border-t border-gray-100 w-full overflow-hidden pb-8 max-h-[85dvh]"
          >
            {/* Handle Bar */}
            <div className="flex justify-center py-4">
              <div className="w-16 h-2 bg-gray-200 rounded-full" />
            </div>

            {/* Content - Scrollable */}
            <div className="overflow-y-auto no-scrollbar px-6 max-h-[calc(85dvh-80px)] pb-12">
              <div className="max-w-2xl">
                {/* Header */}
                <div className="flex justify-between items-start gap-4 mb-6">
                  <div>
                    <h2 className="text-2xl font-black text-text-main">Política de Privacidade</h2>
                    <p className="text-xs text-text-secondary font-medium mt-2">
                      Atualizado em {LAST_UPDATE}
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-2.5 bg-gray-50 hover:bg-gray-100 rounded-full text-text-secondary transition-colors active:scale-95 flex-shrink-0"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Content */}
                <div className="flex flex-col gap-6 text-text-main text-sm leading-relaxed pb-8">
                  <section>
                    <h3 className="font-black text-base text-text-main mb-2">1. Quem somos</h3>
                    <p>
                      O <strong>Rota sem Barreiras</strong> é um website de turismo acessível em
                      Governador Valadares (MG). Ele reúne pontos culturais, patrimoniais e naturais
                      com endereço, como chegar e informações de acessibilidade, além de recursos de
                      leitura em voz alta, alto contraste, Libras e assistente de voz.
                    </p>
                  </section>

                  <section>
                    <h3 className="font-black text-base text-text-main mb-2">2. Quais dados coletamos</h3>
                    <ul className="flex flex-col gap-2 list-disc pl-5">
                      <li>
                        <strong>Sessão anônima:</strong> identificador aleatório para salvar
                        preferências de acessibilidade. Sem nome nem e-mail.
                      </li>
                      <li>
                        <strong>Conta (opcional):</strong> nome, e-mail e senha cifrada.
                      </li>
                      <li>
                        <strong>Preferências de acessibilidade:</strong> contraste, tamanho de fonte,
                        Libras, leitura em voz alta, reduzir movimento e modo dislexia.
                      </li>
                      <li>
                        <strong>Locais abertos:</strong> identificador do ponto e data. Seu texto de
                        busca não é salvo.
                      </li>
                      <li>
                        <strong>QR Codes e selos:</strong> progresso e pontos de experiência.
                      </li>
                      <li>
                        <strong>Relatos:</strong> ponto, se foi "tudo certo" ou "problema" e seu
                        texto. Seu nome fica visível.
                      </li>
                      <li>
                        <strong>Sugestões de locais:</strong> nome, endereço e conta.
                      </li>
                      <li>
                        <strong>Assistente de voz:</strong> data, hora e conta. Nada do conteúdo.
                      </li>
                      <li>
                        <strong>Medição de uso:</strong> eventos anônimos (nunca dados pessoais).
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h3 className="font-black text-base text-text-main mb-2">3. Localização</h3>
                    <p>
                      Só usamos se você autorizar no navegador. Serve para centralizar o mapa, mostrar
                      sua posição e avisar se você está fora de Valadares. Não guardamos. Para o nome
                      da cidade, sua coordenada vai ao serviço Photon (Komoot).
                    </p>
                  </section>

                  <section>
                    <h3 className="font-black text-base text-text-main mb-2">4. Assistente de voz</h3>
                    <p>
                      O áudio vai do seu navegador direto para a API Gemini do Google, em tempo real.
                      <strong> Não é gravado nem armazenado</strong> por nós. Se você tem conta, seu
                      nome é enviado ao Google. Tratamento dos dados segue as políticas do Google.
                    </p>
                  </section>

                  <section>
                    <h3 className="font-black text-base text-text-main mb-2">5. Com quem compartilhamos</h3>
                    <ul className="flex flex-col gap-2 list-disc pl-5">
                      <li><strong>Supabase:</strong> banco de dados e autenticação.</li>
                      <li><strong>Vercel:</strong> hospedagem do website.</li>
                      <li><strong>Google:</strong> API Gemini (assistente de voz) e login Google.</li>
                      <li>
                        <strong>PostHog:</strong> medição de uso sem cookies, sem gravação de sessão,
                        sem dados pessoais.
                      </li>
                      <li><strong>VLibras:</strong> tradução para Libras.</li>
                      <li><strong>Carto:</strong> imagens do mapa.</li>
                      <li><strong>Photon (Komoot):</strong> busca de endereços.</li>
                    </ul>
                  </section>

                  <section>
                    <h3 className="font-black text-base text-text-main mb-2">6. Seus direitos (LGPD)</h3>
                    <p className="mb-3">Você pode pedir a qualquer momento:</p>
                    <ul className="flex flex-col gap-2 list-disc pl-5 mb-3">
                      <li>Confirmação e acesso aos seus dados.</li>
                      <li>Correção de dados incompletos.</li>
                      <li>Exclusão da sua conta e dados ligados.</li>
                      <li>Uma cópia dos seus dados.</li>
                      <li>Revogação do consentimento.</li>
                    </ul>
                    <p>
                      Escreva para <strong>carnelianescuderia@gmail.com</strong>. Respondemos em até
                      30 dias.
                    </p>
                  </section>

                  <section>
                    <h3 className="font-black text-base text-text-main mb-2">7. Contato</h3>
                    <p>
                      Dúvidas sobre privacidade:{" "}
                      <strong>carnelianescuderia@gmail.com</strong>.
                    </p>
                  </section>

                  <section className="pb-4">
                    <h3 className="font-black text-base text-text-main mb-2">8. Mudanças</h3>
                    <p>
                      Quando esta política mudar, atualizamos a data no topo. Última atualização:{" "}
                      {LAST_UPDATE}.
                    </p>
                  </section>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
