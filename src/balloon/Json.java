package balloon;

import java.util.*;

/** Small dependency-free JSON codec. Rejects duplicate keys, trailing data and nonfinite numbers. */
public final class Json {
    private Json() {}
    public static Object parse(String source) {
        Parser p = new Parser(source);
        Object result = p.value(0);
        p.space();
        if (p.i != source.length()) throw new IllegalArgumentException("Лишние данные в JSON");
        return result;
    }
    @SuppressWarnings("unchecked")
    public static Map<String,Object> object(Object value) {
        if (!(value instanceof Map<?,?>)) throw new IllegalArgumentException("Ожидается объект JSON");
        return (Map<String,Object>) value;
    }
    public static Map<String,Object> map(Object... pairs) {
        Map<String,Object> m = new LinkedHashMap<>();
        for (int i=0;i<pairs.length;i+=2) m.put((String)pairs[i], pairs[i+1]);
        return m;
    }
    public static String string(Object value) {
        if(value == null) return "null";
        if(value instanceof String s) {
            StringBuilder b = new StringBuilder("\"");
            for(char c:s.toCharArray()) switch(c) {
                case '"' -> b.append("\\\""); case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n"); case '\r' -> b.append("\\r"); case '\t' -> b.append("\\t");
                default -> { if(c<32) b.append(String.format("\\u%04x",(int)c)); else b.append(c); }
            }
            return b.append('"').toString();
        }
        if(value instanceof Boolean) return value.toString();
        if(value instanceof Number n) {
            if(!Double.isFinite(n.doubleValue())) throw new IllegalArgumentException("Нечисловое значение");
            return n.toString();
        }
        if(value instanceof Map<?,?> m) {
            StringJoiner j=new StringJoiner(",","{","}");
            m.forEach((k,v)->j.add(string(k.toString())+":"+string(v))); return j.toString();
        }
        if(value instanceof Iterable<?> a) {
            StringJoiner j=new StringJoiner(",","[","]"); for(Object v:a)j.add(string(v));return j.toString();
        }
        throw new IllegalArgumentException("Неизвестный тип JSON: "+value.getClass());
    }
    private static final class Parser {
        final String s; int i;
        Parser(String s){this.s=s;}
        void space(){while(i<s.length()&&" \n\t\r".indexOf(s.charAt(i))>=0)i++;}
        RuntimeException error(){return new IllegalArgumentException("Некорректный JSON, позиция "+i);}
        boolean eat(char c){space();if(i<s.length()&&s.charAt(i)==c){i++;return true;}return false;}
        Object value(int depth){
            if(depth>40)throw error();space();if(i>=s.length())throw error(); char c=s.charAt(i);
            if(c=='"')return quoted();
            if(c=='{'){
                i++;Map<String,Object> m=new LinkedHashMap<>();if(eat('}'))return m;
                do{space();String key=quoted();if(m.containsKey(key)||!eat(':'))throw error();m.put(key,value(depth+1));}while(eat(','));
                if(!eat('}'))throw error();return m;
            }
            if(c=='['){i++;List<Object>a=new ArrayList<>();if(eat(']'))return a;do{a.add(value(depth+1));}while(eat(','));if(!eat(']'))throw error();return a;}
            for(String token:List.of("true","false","null"))if(s.startsWith(token,i)){i+=token.length();return token.equals("null")?null:token.equals("true");}
            int start=i;if(c=='-')i++;if(i>=s.length())throw error();
            if(s.charAt(i)=='0')i++;else {int digits=i;while(i<s.length()&&Character.isDigit(s.charAt(i)))i++;if(digits==i)throw error();}
            if(i<s.length()&&s.charAt(i)=='.'){i++;int digits=i;while(i<s.length()&&Character.isDigit(s.charAt(i)))i++;if(digits==i)throw error();}
            if(i<s.length()&&"eE".indexOf(s.charAt(i))>=0){i++;if(i<s.length()&&"+-".indexOf(s.charAt(i))>=0)i++;int digits=i;while(i<s.length()&&Character.isDigit(s.charAt(i)))i++;if(digits==i)throw error();}
            try{String n=s.substring(start,i);if(!n.contains(".")&&!n.contains("e")&&!n.contains("E"))return Long.parseLong(n);double v=Double.parseDouble(n);if(!Double.isFinite(v))throw error();return v;}catch(NumberFormatException ex){throw error();}
        }
        String quoted(){
            if(i>=s.length()||s.charAt(i++)!='"')throw error();StringBuilder b=new StringBuilder();
            while(i<s.length()){
                char c=s.charAt(i++);if(c=='"')return b.toString();if(c<32)throw error();
                if(c=='\\'){
                    if(i>=s.length())throw error();c=s.charAt(i++);
                    switch(c){case '"','\\','/'->b.append(c);case 'b'->b.append('\b');case 'f'->b.append('\f');case 'n'->b.append('\n');case 'r'->b.append('\r');case 't'->b.append('\t');case 'u'->{if(i+4>s.length())throw error();try{b.append((char)Integer.parseInt(s.substring(i,i+4),16));}catch(NumberFormatException e){throw error();}i+=4;}default->throw error();}
                }else b.append(c);
            }throw error();
        }
    }
}
