import readline from 'node:readline'

/** Ask on the terminal. With hidden:true nothing is echoed, so a password never lands on screen or in scrollback. */
export function ask(question, { hidden = false } = {}) {
  if (!process.stdin.isTTY) return Promise.reject(new Error(`Cannot ask "${question.trim()}" without a terminal. Set the matching environment variable instead.`))
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (hidden) rl._writeToOutput = str => { if (str.startsWith(question)) rl.output.write(str) }
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()) })
  })
}
