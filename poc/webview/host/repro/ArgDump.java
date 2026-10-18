import java.nio.charset.StandardCharsets; import java.nio.file.*;
public class ArgDump { public static void main(String[] a) throws Exception {
  StringBuilder sb = new StringBuilder();
  sb.append("file.encoding=").append(System.getProperty("file.encoding")).append(" native=").append(System.getProperty("native.encoding")).append('\n');
  for (int i=0;i<a.length;i++) { sb.append(i).append(": ").append(a[i]).append('\n');
    sb.append("   hex="); for (byte b : a[i].getBytes(StandardCharsets.UTF_8)) sb.append(String.format("%02x", b)); sb.append('\n'); }
  Files.write(Paths.get("repro/argdump.txt"), sb.toString().getBytes(StandardCharsets.UTF_8)); } }
