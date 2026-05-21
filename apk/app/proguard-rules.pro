# Keep Kotlin serializer classes
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keep,includedescriptorclasses class com.mcc.console.**$$serializer { *; }
-keepclassmembers class com.mcc.console.** {
    *** Companion;
}
-keepclasseswithmembers class com.mcc.console.** {
    kotlinx.serialization.KSerializer serializer(...);
}
