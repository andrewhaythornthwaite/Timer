//  ContentView.swift
//  Circuit Timer — interval timer for HIIT circuits
//  Drop this into a new Xcode iOS App project, replacing the generated ContentView.swift.

import SwiftUI
import AVFoundation
import UIKit

// MARK: - Model

enum Phase: String {
    case prep = "Get ready"
    case work = "Work"
    case rest = "Rest"
    case brk  = "Break"

    var color: Color {
        switch self {
        case .prep: return Color(red: 0.78, green: 0.53, blue: 0.10)
        case .work: return Color(red: 0.85, green: 0.20, blue: 0.11)
        case .rest: return Color(red: 0.08, green: 0.42, blue: 0.40)
        case .brk:  return Color(red: 0.17, green: 0.23, blue: 0.55)
        }
    }
}

struct Step {
    let phase: Phase
    let duration: Int
    let exercise: Int
    let rep: Int
}

struct Settings {
    var work = 20
    var rest = 40
    var reps = 5
    var exercises = 3
    var brk = 60
    var prep = 10
    var sound = true

    func schedule() -> [Step] {
        var out: [Step] = []
        if prep > 0 { out.append(Step(phase: .prep, duration: prep, exercise: 1, rep: 1)) }
        for e in 1...max(1, exercises) {
            for r in 1...max(1, reps) {
                out.append(Step(phase: .work, duration: work, exercise: e, rep: r))
                let lastRep = (r == reps), lastEx = (e == exercises)
                if lastRep && lastEx { continue }
                if lastRep {
                    if brk > 0 { out.append(Step(phase: .brk, duration: brk, exercise: e, rep: r)) }
                } else if rest > 0 {
                    out.append(Step(phase: .rest, duration: rest, exercise: e, rep: r))
                }
            }
        }
        return out
    }

    var totalSeconds: Int { schedule().reduce(0) { $0 + $1.duration } }
}

// MARK: - Sound
// AVAudioSession .playback means the beeps come through even with the ringer
// switch on silent, and keep playing when the screen locks.

final class Beeper {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
    private var started = false

    func activate() {
        guard !started else { return }
        do {
            let s = AVAudioSession.sharedInstance()
            try s.setCategory(.playback, mode: .default, options: [.duckOthers])
            try s.setActive(true)
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: format)
            try engine.start()
            player.play()
            started = true
        } catch {
            print("audio setup failed:", error)
        }
    }

    /// segments: (frequency Hz, duration s, gap after s)
    func play(_ segments: [(Double, Double, Double)], volume: Float = 0.85) {
        activate()
        let sr = format.sampleRate
        let total = segments.reduce(0.0) { $0 + $1.1 + $1.2 }
        let frames = AVAudioFrameCount(sr * total)
        guard frames > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
              let data = buffer.floatChannelData?[0] else { return }
        buffer.frameLength = frames

        var i = 0
        for (freq, dur, gap) in segments {
            let n = Int(sr * dur)
            for k in 0..<n where i < Int(frames) {
                let t = Double(k) / sr
                let env = min(1.0, t / 0.004, (dur - t) / 0.03)
                let square: Double = sin(2 * .pi * freq * t) >= 0 ? 1 : -1
                data[i] = Float(square * max(0, env)) * volume
                i += 1
            }
            for _ in 0..<Int(sr * gap) where i < Int(frames) { data[i] = 0; i += 1 }
        }
        player.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
    }

    func tick()  { play([(880, 0.10, 0)], volume: 0.7) }
    func work()  { play([(1150, 0.15, 0.07), (1150, 0.15, 0)]) }
    func rest()  { play([(500, 0.34, 0)]) }
    func brk()   { play([(430, 0.22, 0.06), (330, 0.34, 0)]) }
    func done()  { play([(660, 0.17, 0.05), (880, 0.17, 0.05), (1320, 0.50, 0)], volume: 0.95) }
}

// MARK: - Engine

final class TimerEngine: ObservableObject {
    @Published var running = false
    @Published var paused = false
    @Published var finished = false
    @Published var index = 0
    @Published var remaining: Double = 0
    @Published var elapsed: Double = 0

    var schedule: [Step] = []
    var settings = Settings()

    private let beeper = Beeper()
    private var ticker: Timer?
    private var endAt = Date()
    private var startedAt = Date()
    private var lastWhole = -1
    private var pausedFor: TimeInterval = 0
    private var pauseBegan = Date()

    var step: Step? { schedule.indices.contains(index) ? schedule[index] : nil }
    var next: Step? { schedule.indices.contains(index + 1) ? schedule[index + 1] : nil }

    func start(_ s: Settings) {
        settings = s
        schedule = s.schedule()
        guard !schedule.isEmpty else { return }
        beeper.activate()
        running = true; paused = false; finished = false
        pausedFor = 0; startedAt = Date()
        UIApplication.shared.isIdleTimerDisabled = true
        enter(0)
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 0.03, repeats: true) { [weak self] _ in
            self?.tick()
        }
    }

    private func enter(_ i: Int) {
        index = i
        guard let s = step else { return }
        endAt = Date().addingTimeInterval(Double(s.duration))
        remaining = Double(s.duration)
        lastWhole = -1
        guard settings.sound else { haptic(s.phase); return }
        switch s.phase {
        case .work: beeper.work()
        case .rest: beeper.rest()
        case .brk:  beeper.brk()
        case .prep: break
        }
        haptic(s.phase)
    }

    private func haptic(_ p: Phase) {
        let style: UIImpactFeedbackGenerator.FeedbackStyle = (p == .work) ? .heavy : .medium
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }

    private func tick() {
        guard running, !paused else { return }
        remaining = endAt.timeIntervalSinceNow
        elapsed = Date().timeIntervalSince(startedAt) - pausedFor

        let whole = Int(ceil(remaining))
        if whole != lastWhole {
            lastWhole = whole
            if whole <= 3 && whole > 0 {
                if settings.sound { beeper.tick() }
                UISelectionFeedbackGenerator().selectionChanged()
            }
        }
        if remaining <= 0 {
            if index + 1 < schedule.count { enter(index + 1) } else { finish() }
        }
    }

    func togglePause() {
        guard running else { return }
        paused.toggle()
        if paused {
            pauseBegan = Date()
            UIApplication.shared.isIdleTimerDisabled = false
        } else {
            let gap = Date().timeIntervalSince(pauseBegan)
            endAt = endAt.addingTimeInterval(gap)
            pausedFor += gap
            UIApplication.shared.isIdleTimerDisabled = true
        }
    }

    func skip() {
        guard running else { return }
        if index + 1 < schedule.count { enter(index + 1) } else { finish() }
    }

    private func finish() {
        if settings.sound { beeper.done() }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        finished = true
        ticker?.invalidate(); ticker = nil
        UIApplication.shared.isIdleTimerDisabled = false
    }

    func stop() {
        running = false; paused = false; finished = false
        ticker?.invalidate(); ticker = nil
        UIApplication.shared.isIdleTimerDisabled = false
    }

    func testSound() { beeper.work() }
}

// MARK: - Setup screen

struct ContentView: View {
    @AppStorage("work") private var work = 20
    @AppStorage("rest") private var rest = 40
    @AppStorage("reps") private var reps = 5
    @AppStorage("exercises") private var exercises = 3
    @AppStorage("brk") private var brk = 60
    @AppStorage("prep") private var prep = 10
    @AppStorage("sound") private var sound = true

    @StateObject private var engine = TimerEngine()

    private var settings: Settings {
        Settings(work: work, rest: rest, reps: reps, exercises: exercises,
                 brk: brk, prep: prep, sound: sound)
    }

    private let ground = Color(red: 0.93, green: 0.91, blue: 0.87)
    private let ink = Color(red: 0.08, green: 0.09, blue: 0.10)

    var body: some View {
        ZStack {
            setup
            if engine.running { RunView(engine: engine).transition(.opacity) }
        }
        .animation(.easeInOut(duration: 0.25), value: engine.running)
    }

    private var setup: some View {
        ZStack {
            ground.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("CIRCUIT\nTIMER")
                            .font(.system(size: 52, weight: .bold, design: .default))
                            .kerning(1).lineSpacing(-8)
                        Text("WORK · REST · REPS · EXERCISES")
                            .font(.system(size: 11, weight: .semibold)).kerning(2.4)
                            .foregroundColor(ink.opacity(0.6))
                    }
                    .padding(.bottom, 12)
                    Rectangle().fill(ink).frame(height: 2)

                    row("WORK", "Seconds on", $work, step: 5, range: 5...600, swatch: Phase.work.color)
                    row("REST", "Seconds off", $rest, step: 5, range: 0...600, swatch: Phase.rest.color)
                    row("REPS", "Rounds of each exercise", $reps, step: 1, range: 1...99, swatch: nil)
                    row("EXERCISES", "Different movements", $exercises, step: 1, range: 1...30, swatch: nil)
                    row("BREAK", "Between exercises", $brk, step: 10, range: 0...900, swatch: Phase.brk.color)
                    row("LEAD-IN", "Countdown before the first rep", $prep, step: 5, range: 0...120, swatch: nil)

                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("SOUND").font(.system(size: 21, weight: .semibold)).kerning(1.2)
                            Text("Plays through the silent switch")
                                .font(.system(size: 12.5)).foregroundColor(ink.opacity(0.6))
                        }
                        Spacer()
                        Button("TEST") { engine.testSound() }
                            .font(.system(size: 15, weight: .semibold)).kerning(1.4)
                            .padding(.horizontal, 16).padding(.vertical, 9)
                            .overlay(Rectangle().stroke(ink.opacity(0.3), lineWidth: 1))
                            .foregroundColor(ink)
                        Toggle("", isOn: $sound).labelsHidden().tint(ink)
                    }
                    .padding(.vertical, 15)

                    Rectangle().fill(ink).frame(height: 2).padding(.top, 6)
                    HStack(alignment: .firstTextBaseline) {
                        Text("TOTAL TIME").font(.system(size: 11, weight: .semibold)).kerning(2.4)
                            .foregroundColor(ink.opacity(0.6))
                        Spacer()
                        Text(pretty(settings.totalSeconds))
                            .font(.system(size: 34, weight: .semibold))
                    }
                    .padding(.vertical, 16)

                    Text("\(reps) × (\(work)s on / \(rest)s off) per exercise · \(exercises) exercise\(exercises > 1 ? "s" : "")"
                         + (brk > 0 && exercises > 1 ? " · \(brk)s break between" : ""))
                        .font(.system(size: 12.5)).foregroundColor(ink.opacity(0.6))

                    Button {
                        engine.start(settings)
                    } label: {
                        Text("START")
                            .font(.system(size: 26, weight: .semibold)).kerning(4)
                            .frame(maxWidth: .infinity).padding(.vertical, 20)
                            .background(ink).foregroundColor(ground)
                    }
                    .padding(.top, 18)
                }
                .padding(.horizontal, 20).padding(.vertical, 22)
                .frame(maxWidth: 560)
            }
            .foregroundColor(ink)
        }
    }

    private func row(_ title: String, _ sub: String, _ value: Binding<Int>,
                     step: Int, range: ClosedRange<Int>, swatch: Color?) -> some View {
        HStack(spacing: 14) {
            Rectangle().fill(swatch ?? ink.opacity(0.12)).frame(width: 9)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 21, weight: .semibold)).kerning(1.2)
                Text(sub).font(.system(size: 12.5)).foregroundColor(ink.opacity(0.6))
            }
            Spacer(minLength: 8)
            HStack(spacing: 2) {
                stepButton("−") { value.wrappedValue = max(range.lowerBound, value.wrappedValue - step) }
                Text("\(value.wrappedValue)")
                    .font(.system(size: 28, weight: .semibold))
                    .monospacedDigit().frame(width: 62)
                stepButton("+") { value.wrappedValue = min(range.upperBound, value.wrappedValue + step) }
            }
        }
        .frame(height: 72)
        .overlay(Rectangle().fill(ink.opacity(0.12)).frame(height: 1), alignment: .bottom)
    }

    private func stepButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(.system(size: 24, weight: .regular))
                .frame(width: 42, height: 42)
                .overlay(Circle().stroke(ink.opacity(0.3), lineWidth: 1))
        }
        .foregroundColor(ink)
    }

    private func pretty(_ s: Int) -> String {
        let m = s / 60, r = s % 60
        if m == 0 { return "\(r)s" }
        return r == 0 ? "\(m)m" : "\(m)m \(r)s"
    }
}

// MARK: - Run screen

struct RunView: View {
    @ObservedObject var engine: TimerEngine

    var body: some View {
        let step = engine.step
        let phase = step?.phase ?? .work
        let bg = engine.finished ? Color(white: 0.07) : phase.color

        ZStack(alignment: .bottom) {
            bg.ignoresSafeArea()

            // the screen itself is the progress bar — it drains
            GeometryReader { geo in
                let frac = step.map { max(0, min(1, engine.remaining / Double($0.duration))) } ?? 0
                Color.white.opacity(0.10)
                    .frame(height: geo.size.height * (engine.finished ? 0 : frac))
                    .frame(maxHeight: .infinity, alignment: .bottom)
            }
            .ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    Text(engine.finished ? "SESSION COMPLETE"
                         : (phase == .prep ? "STARTING"
                            : "EXERCISE \(step?.exercise ?? 1) / \(engine.settings.exercises)"))
                    Spacer()
                    Text(clock(engine.elapsed))
                }
                .font(.system(size: 11, weight: .semibold)).kerning(2.4)
                .foregroundColor(.white.opacity(0.75))

                Spacer()

                Text(engine.finished ? "DONE" : phase.rawValue.uppercased())
                    .font(.system(size: 40, weight: .bold)).kerning(11)
                    .padding(.leading, 11)
                    .foregroundColor(.white.opacity(0.92))

                Text(engine.finished ? "✓" : bigNumber)
                    .font(.system(size: 150, weight: .semibold))
                    .monospacedDigit().minimumScaleFactor(0.4).lineLimit(1)
                    .foregroundColor(.white)

                Text(nextLabel)
                    .font(.system(size: 13, weight: .medium)).kerning(2)
                    .foregroundColor(.white.opacity(0.7))
                    .padding(.top, 14)

                if !engine.finished, let s = step {
                    HStack(spacing: 6) {
                        ForEach(1...max(1, engine.settings.reps), id: \.self) { r in
                            Rectangle()
                                .fill(Color.white.opacity(r <= s.rep && s.phase != .prep ? 0.95 : 0.28))
                                .frame(width: 26, height: 6)
                        }
                    }
                    .padding(.top, 26)
                }

                Spacer()

                HStack(spacing: 10) {
                    control(engine.finished ? "AGAIN" : (engine.paused ? "RESUME" : "PAUSE")) {
                        if engine.finished { engine.start(engine.settings) } else { engine.togglePause() }
                    }
                    if !engine.finished { control("SKIP") { engine.skip() } }
                    control("END") { engine.stop() }
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)

            if engine.paused {
                Color.black.opacity(0.42).ignoresSafeArea()
                    .overlay(Text("PAUSED")
                        .font(.system(size: 46, weight: .bold)).kerning(13)
                        .padding(.leading, 13).foregroundColor(.white))
            }
        }
        .animation(.easeInOut(duration: 0.3), value: engine.index)
        .statusBarHidden()
    }

    private var bigNumber: String {
        let r = max(0, engine.remaining)
        return r >= 60 ? clock(r) : "\(Int(ceil(r)))"
    }

    private var nextLabel: String {
        if engine.finished {
            return "\(engine.settings.exercises) EXERCISES · \(engine.settings.reps) REPS EACH"
        }
        guard let n = engine.next else { return "LAST ONE — FINISH STRONG" }
        let extra = n.phase == .work ? " · REP \(n.rep)" : ""
        return "NEXT — \(n.phase.rawValue.uppercased()) \(n.duration)S\(extra)"
    }

    private func control(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(.system(size: 19, weight: .semibold)).kerning(2.6)
                .frame(maxWidth: .infinity).padding(.vertical, 19)
                .background(Color.white.opacity(0.14))
                .foregroundColor(.white)
        }
    }

    private func clock(_ s: Double) -> String {
        let t = max(0, Int(s.rounded()))
        return String(format: "%02d:%02d", t / 60, t % 60)
    }
}
