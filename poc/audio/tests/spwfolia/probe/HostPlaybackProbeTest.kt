package spwfolia.probe

/**
 * Tests [HostPlaybackProbe] against *fake* host classes that mimic the real SPW 1.19.0 object
 * graph (controller singleton -> private service field -> getPlayer() -> long getters).
 * No real Salt Player / SPW process is involved.
 */
object HostPlaybackProbeTest {
    private var failures = 0
    private var checks = 0

    private fun check(name: String, condition: Boolean, detail: String) {
        checks++
        if (condition) println("  PASS  $name ($detail)") else {
            failures++
            println("  FAIL  $name ($detail)")
        }
    }

    private val fakeConfig = ProbeConfig(
        controllerClassName = "fake.host.FakeController",
        serviceClassName = "fake.host.FakeService",
        playerClassName = "fake.host.FakePlayer",
        monitorClassName = "fake.host.FakeMonitor",
    )

    private fun testResolution() {
        println("[resolution] fake controller -> private service field -> getPlayer() -> long getters")
        check("host present", HostPlaybackProbe.isHostPresent(fakeConfig), "fake.host.FakeController")
        val controller = HostPlaybackProbe.findController(fakeConfig)
        check("controller instance", controller != null, "${controller?.javaClass?.name}")
        val service = HostPlaybackProbe.findService(fakeConfig, controller)
        check("service via private field", service != null, "${service?.javaClass?.name}")
        val player = HostPlaybackProbe.findPlayer(fakeConfig, service)
        check("player via getPlayer()", player != null, "${player?.javaClass?.name}")

        val candidates = if (player != null) HostPlaybackProbe.longGetters(player) else emptyList()
        check("two long getters found", candidates.size == 2,
            candidates.map { it.name }.joinToString(","))
    }

    private fun testCalibratedResolution() {
        println("[calibrated resolution] 1 Hz hint separates position from duration")
        val player = fake.host.FakePlayer()
        val hint = player.pos()
        val resolved = HostPlaybackProbe.resolvePlayer(player, fakeConfig) { hint }
        check("resolved", resolved != null, "null")
        if (resolved != null) {
            check("position getter is pos()", resolved.position.name == "pos", resolved.position.name)
            check("duration getter is dur()", resolved.duration?.name == "dur", resolved.duration?.name ?: "null")
            val pos = HostPlaybackProbe.invokeLong(resolved.position, player)
            check("position value sane", pos != null && Math.abs(pos - player.pos()) <= 50,
                "$pos vs ${player.pos()}")
            val dur = resolved.duration?.let { HostPlaybackProbe.invokeLong(it, player) }
            check("duration value", dur == fake.host.FakePlayer.DURATION_MS, "$dur")
        }
    }

    private fun testHeuristicResolution() {
        println("[heuristic resolution] no hint: incrementing getter wins")
        val player = fake.host.FakePlayer()
        val resolved = HostPlaybackProbe.resolvePlayer(player, fakeConfig, null)
        check("resolved without hint", resolved != null, "null")
        if (resolved != null) {
            check("heuristic position getter", resolved.position.name == "pos", resolved.position.name)
            check("heuristic duration getter", resolved.duration?.name == "dur", resolved.duration?.name ?: "null")
        }
    }

    private fun testPositionSource() {
        println("[position source] lazy resolution + polling")
        val player = fake.host.FakePlayer()
        val hint = player.pos()
        val source = HostPlaybackProbe.createPositionSource(fakeConfig) { hint }
        val p1 = source.pollPositionMs()
        Thread.sleep(150)
        val p2 = source.pollPositionMs()
        check("poll position non-null", p1 != null && p2 != null, "$p1 -> $p2")
        check("poll position advances", p1 != null && p2 != null && p2 > p1, "$p1 -> $p2")
        check("poll duration", source.pollDurationMs() == fake.host.FakePlayer.DURATION_MS,
            "${source.pollDurationMs()}")
        check("describe mentions position", source.describe().contains("position="), source.describe())
    }

    private fun testRealHostAbsent() {
        println("[real host absent] default config degrades gracefully")
        val default = ProbeConfig()
        check("real host not present in tests", !HostPlaybackProbe.isHostPresent(default), "absent")
        check("controller null", HostPlaybackProbe.findController(default) == null, "null")
        val source = HostPlaybackProbe.createPositionSource(default)
        check("source returns null", source.pollPositionMs() == null, "null")
        check("monitor lyrics time null", HostPlaybackProbe.findMonitorLyricsTime(default) == null, "null")
    }

    @JvmStatic
    fun main(args: Array<String>) {
        println("HostPlaybackProbe tests (fake host classes; real host not launched)")
        testResolution()
        testCalibratedResolution()
        testHeuristicResolution()
        testPositionSource()
        testRealHostAbsent()
        println()
        println("RESULT: $checks checks, $failures failures")
        if (failures > 0) System.exit(1)
    }
}

