package net.freqhole.charnel

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.lang.reflect.Modifier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NsdBridgeContractTest {
    @Test
    fun bridge_is_loadable_and_jni_methods_survive_shrinking() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val executor = Executors.newSingleThreadExecutor()
        try {
            executor.submit {
                val bridge = context.classLoader.loadClass("net.freqhole.augur.NsdBridge")
                val string = String::class.java
                val int = Int::class.javaPrimitiveType!!
                val methods = listOf(
                    bridge.getDeclaredMethod(
                        "startAdvertising", Context::class.java, string, string, int, string, string
                    ),
                    bridge.getDeclaredMethod("stopAdvertising"),
                    bridge.getDeclaredMethod("startDiscovery", Context::class.java, string),
                    bridge.getDeclaredMethod("stopDiscovery"),
                    bridge.getDeclaredMethod("nativeOnResolved", string, string, int, string, string),
                    bridge.getDeclaredMethod("nativeOnLost", string),
                )
                methods.forEach {
                    assertTrue(Modifier.isStatic(it.modifiers))
                    assertEquals(Void.TYPE, it.returnType)
                }
                assertTrue(Modifier.isNative(methods[4].modifiers))
                assertTrue(Modifier.isNative(methods[5].modifiers))
                methods[3].invoke(null)
            }.get(10, TimeUnit.SECONDS)
        } finally {
            executor.shutdownNow()
        }
    }
}
